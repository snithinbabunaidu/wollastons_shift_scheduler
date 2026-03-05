const db = require('../db/knex');

// ═══════════════════════════════════════════════════════════════
// Utility functions
// ═══════════════════════════════════════════════════════════════

function calcHours(startTime, endTime) {
  if (!startTime || !endTime) return 7;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return (endMin - startMin) / 60;
}

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function timesOverlap(shiftStart, shiftEnd, blockStart, blockEnd) {
  let ss = toMinutes(shiftStart);
  let se = toMinutes(shiftEnd);
  let bs = toMinutes(blockStart);
  let be = toMinutes(blockEnd);
  if (se <= ss) se += 24 * 60;
  if (be <= bs) be += 24 * 60;
  return ss < be && bs < se;
}

const MANAGER_START_TIMES = {
  morning: ['06:00'],
  afternoon: ['11:00', '13:00'],
  night: ['18:00'],
};

const MIN_MORNING_AFTER_NIGHT = '10:00';

function workedNightPreviousDay(empId, day, assignments, lockedEntries) {
  const prevDay = day - 1;
  if (prevDay < 0) return false;
  const all = [...(assignments || []), ...(lockedEntries || [])];
  return all.some(a => a.employee_id === empId && a.day_of_week === prevDay && a.shift_period === 'night');
}

function isEmployeeAvailable(emp, unavailMap, oldAvailMap, day, shiftStart, shiftEnd, period) {
  const empUnavail = unavailMap[emp.id];
  if (empUnavail && empUnavail.length > 0) {
    const dayBlocks = empUnavail.filter(u => u.day_of_week === day);
    for (const block of dayBlocks) {
      if (timesOverlap(shiftStart, shiftEnd, block.start_time, block.end_time)) {
        return false;
      }
    }
    return true;
  }
  if (oldAvailMap[emp.id]) {
    return oldAvailMap[emp.id][`${day}-${period}`] !== false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Build all slots for the week (flat list)
// ═══════════════════════════════════════════════════════════════

function buildAllSlots(shiftConfigs, settingsMap, slotCounts, lockedEntries) {
  const slots = [];
  for (let day = 0; day < 7; day++) {
    for (const period of ['morning', 'afternoon', 'night']) {
      const slotsNeeded = settingsMap[`${day}-${period}`] || slotCounts[period];
      const periodConfigs = shiftConfigs.filter(c => c.shift_period === period);

      for (let slotIdx = 0; slotIdx < slotsNeeded; slotIdx++) {
        const config = periodConfigs[slotIdx] || periodConfigs[periodConfigs.length - 1];
        const hours = calcHours(config.start_time, config.end_time);
        const isManagerSlot = slotIdx === 0 && period !== 'morning';

        const lockedEntry = lockedEntries.find(
          e => e.day_of_week === day && e.shift_period === period && e.slot_index === slotIdx
        );

        slots.push({
          day,
          period,
          slotIdx,
          startTime: config.start_time,
          endTime: config.end_time,
          hours,
          isManagerSlot,
          isLocked: !!lockedEntry,
          lockedEmployeeId: lockedEntry ? lockedEntry.employee_id : null,
        });
      }
    }
  }
  return slots;
}

// ═══════════════════════════════════════════════════════════════
// Eligibility check (hard constraints only)
// ═══════════════════════════════════════════════════════════════

function isEligible(emp, slot, tracking, ctx, relaxed = false) {
  // One shift per day
  if (tracking.daysAssigned[emp.id].has(slot.day)) return false;

  // Hours limit (relaxed mode: always allow at least 2h overflow to fill slots)
  const overflow = relaxed ? Math.max(ctx.overflowHours, 2) : 0;
  const maxAllowed = emp.max_hours + overflow;
  if (tracking.hoursUsed[emp.id] + slot.hours > maxAllowed) return false;

  // External coop: weekends only, max 2 shifts
  if (emp.employment_type === 'external_coop') {
    if (slot.day !== 0 && slot.day !== 6) return false;
    if (tracking.shiftsAssigned[emp.id] >= 2) return false;
  }

  // Trainee: no 6AM morning
  if (emp.is_trainee && slot.period === 'morning' && slot.startTime === '06:00') return false;

  // Manager role restrictions
  const hasManagerRole = emp.roles.some(r => r.endsWith('_manager'));
  if (hasManagerRole) {
    // Managers can only work their designated period
    if (!emp.roles.some(r => r.replace('_manager', '') === slot.period)) return false;
  } else if (!relaxed) {
    // Strict: non-managers skip manager-designated slots (slot 0 of afternoon/night)
    if (slot.isManagerSlot) return false;
  }

  // Night-to-morning rest rule
  if (slot.period === 'morning' && slot.startTime < MIN_MORNING_AFTER_NIGHT) {
    if (workedNightPreviousDay(emp.id, slot.day, tracking.assignments, ctx.lockedEntries)) return false;
  }

  // Availability (NEVER relaxed)
  if (!isEmployeeAvailable(emp, ctx.unavailMap, ctx.oldAvailMap, slot.day, slot.startTime, slot.endTime, slot.period)) {
    return false;
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════
// Ideal shift count and hour bonus
// ═══════════════════════════════════════════════════════════════

function getIdealShiftCount(emp) {
  if (emp.employment_type === 'external_coop') return 2;
  return Math.ceil(emp.max_hours / 7);
}

function computeIdealShiftBonus(emp, slot, tracking, standardDurations) {
  const remaining = emp.max_hours - tracking.hoursUsed[emp.id];
  const afterThis = remaining - slot.hours;

  if (afterThis < 0) return -1000;
  if (afterThis === 0) return 200; // perfect fit

  // Count minimum shifts needed to cover afterThis using standard durations
  let minShiftsNeeded = 0;
  let hoursLeft = afterThis;
  for (const dur of standardDurations) {
    while (hoursLeft >= dur) {
      hoursLeft -= dur;
      minShiftsNeeded++;
    }
  }
  if (hoursLeft > 0) minShiftsNeeded++;

  const totalShifts = tracking.shiftsAssigned[emp.id] + 1 + minShiftsNeeded;
  const ideal = getIdealShiftCount(emp);

  if (totalShifts <= ideal) return 200;
  if (totalShifts === ideal + 1) return 150;
  if (totalShifts === ideal + 2) return 80;
  return 0; // Never penalize extra shifts — filling slots is priority
}

// ═══════════════════════════════════════════════════════════════
// Scoring function
// ═══════════════════════════════════════════════════════════════

function computeScore(emp, slot, tracking, ctx) {
  let score = 0;

  // ═══ T1: Critical role matching (800-1200) ═══
  const isFoodOrderEmp = emp.roles.includes('ag_food_order') || emp.roles.includes('us_food_order');
  const isOrderDay = ctx.orderDaysMap.ag.includes(slot.day) || ctx.orderDaysMap.us.includes(slot.day);
  if (isFoodOrderEmp && isOrderDay && slot.period === 'morning') {
    score += 1000;
    if (slot.startTime === '06:00') score += 200;
  }

  if (slot.isManagerSlot && emp.roles.includes(`${slot.period}_manager`)) {
    score += 800;
  }

  // ═══ T2: Fairness (300-700) ═══
  if (tracking.shiftsAssigned[emp.id] === 0) score += 700;
  else if (tracking.shiftsAssigned[emp.id] === 1) score += 300;

  const utilization = tracking.hoursUsed[emp.id] / emp.max_hours;
  score += (1 - utilization) * 500;

  // Spread penalty (soft — filling slots is more important than perfect fairness)
  const totalEmps = ctx.employees.length;
  const totalAssigned = ctx.employees.reduce((s, e) => s + tracking.shiftsAssigned[e.id], 0);
  const avgShifts = totalAssigned / totalEmps;
  if (tracking.shiftsAssigned[emp.id] >= avgShifts + 2) score -= 150;
  else if (tracking.shiftsAssigned[emp.id] >= avgShifts + 1) score -= 50;

  // ═══ T3: Shift quality (200-500) ═══
  score += computeIdealShiftBonus(emp, slot, tracking, ctx.standardDurations);

  const hoursAfter = tracking.hoursUsed[emp.id] + slot.hours;
  if (hoursAfter === emp.max_hours) score += 300;
  else if (emp.max_hours - hoursAfter > 0 && emp.max_hours - hoursAfter <= 1) score += 100;

  // ═══ T4: Composition (200-400) ═══
  const key = `${slot.day}-${slot.period}`;
  const periodAssignments = tracking.dayPeriodAssignments[key] || [];

  const hasNonTrainee = periodAssignments.some(a => {
    const e = ctx.employees.find(x => x.id === a.employee_id);
    return e && !e.is_trainee;
  });
  if (!hasNonTrainee && !emp.is_trainee) score += 300;

  if (slot.period === 'night') {
    const hasMale = periodAssignments.some(a => {
      const e = ctx.employees.find(x => x.id === a.employee_id);
      return e && e.gender === 'male';
    });
    if (!hasMale && emp.gender === 'male') score += 400;
  }

  if (slot.period === 'morning' && slot.startTime === '07:00' &&
      slot.day >= 1 && slot.day <= 5 && emp.is_trainee) {
    score += 350;
  }

  if (emp.employment_type === 'external_coop') {
    if (slot.period === 'night') score += 500;
    else score -= 300;
  }

  // ═══ T5: Employee scarcity — fewer available slots = higher priority ═══
  const eligibleSlots = ctx.empEligibleSlotCount[emp.id] || 1;
  if (eligibleSlots <= 5) score += 600;       // Very constrained (e.g., Gaurang: only 8PM-1AM Mon-Thu)
  else if (eligibleSlots <= 10) score += 400;
  else if (eligibleSlots <= 20) score += 200;
  // Flexible employees (20+ slots) get no bonus — they can fit anywhere

  // ═══ T6: Tiebreakers ═══
  score += (emp.max_hours - tracking.hoursUsed[emp.id]) / emp.max_hours * 50;
  if (emp.is_trainee) score -= 30;

  return score;
}

// ═══════════════════════════════════════════════════════════════
// Slot priority comparator (most constrained first)
// ═══════════════════════════════════════════════════════════════

function slotPriorityComparator(a, b) {
  if (a.eligibleCount !== b.eligibleCount) return a.eligibleCount - b.eligibleCount;
  if (a.isManagerSlot !== b.isManagerSlot) return (b.isManagerSlot ? 1 : 0) - (a.isManagerSlot ? 1 : 0);
  if (a.hours !== b.hours) return b.hours - a.hours;
  const periodOrder = { night: 0, afternoon: 1, morning: 2 };
  if (a.period !== b.period) return periodOrder[a.period] - periodOrder[b.period];
  return b.day - a.day;
}

// ═══════════════════════════════════════════════════════════════
// Assignment helper
// ═══════════════════════════════════════════════════════════════

function assignToSlot(emp, slot, tracking, weekStart) {
  const assignment = {
    week_start_date: weekStart,
    day_of_week: slot.day,
    shift_period: slot.period,
    slot_index: slot.slotIdx,
    employee_id: emp.id,
    is_locked: false,
    start_time: slot.startTime,
    end_time: slot.endTime,
  };
  tracking.assignments.push(assignment);
  tracking.hoursUsed[emp.id] += slot.hours;
  tracking.shiftsAssigned[emp.id] += 1;
  tracking.daysAssigned[emp.id].add(slot.day);
  tracking.dayEmployees[slot.day].add(emp.id);

  const key = `${slot.day}-${slot.period}`;
  if (!tracking.dayPeriodAssignments[key]) tracking.dayPeriodAssignments[key] = [];
  tracking.dayPeriodAssignments[key].push(assignment);
}

// ═══════════════════════════════════════════════════════════════
// Pre-assign food order employees
// ═══════════════════════════════════════════════════════════════

function preAssignFoodOrders(openSlots, tracking, ctx, weekStart) {
  for (const type of ['ag', 'us']) {
    const role = `${type}_food_order`;
    for (const day of ctx.orderDaysMap[type]) {
      const foodEmps = ctx.employees.filter(e => e.roles.includes(role));
      for (const emp of foodEmps) {
        if (tracking.daysAssigned[emp.id].has(day)) continue;

        // Find best morning slot on this day
        const morningSlots = openSlots.filter(s => s.day === day && s.period === 'morning');
        morningSlots.sort((a, b) => {
          if (a.startTime === '06:00' && b.startTime !== '06:00') return -1;
          if (b.startTime === '06:00' && a.startTime !== '06:00') return 1;
          return a.startTime.localeCompare(b.startTime);
        });

        for (const slot of morningSlots) {
          if (isEligible(emp, slot, tracking, ctx, false)) {
            assignToSlot(emp, slot, tracking, weekStart);
            const idx = openSlots.indexOf(slot);
            if (idx !== -1) openSlots.splice(idx, 1);
            break;
          }
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Relaxed backfill for remaining empty slots
// ═══════════════════════════════════════════════════════════════

function relaxedBackfill(deferredSlots, tracking, ctx, weekStart) {
  // Multiple passes with increasing relaxation
  let remaining = [...deferredSlots];

  // Pass 1: relaxed mode (managers can fill any slot, non-managers can fill manager slots)
  // with 2h overflow tolerance
  let stillRemaining = [];
  for (const slot of remaining) {
    let bestEmp = null;
    let bestScore = -Infinity;

    for (const emp of ctx.employees) {
      if (!isEligible(emp, slot, tracking, ctx, true)) continue;
      const score = computeScore(emp, slot, tracking, ctx);
      if (score > bestScore) {
        bestScore = score;
        bestEmp = emp;
      }
    }

    if (bestEmp) {
      assignToSlot(bestEmp, slot, tracking, weekStart);
    } else {
      stillRemaining.push(slot);
    }
  }

  // Pass 2: even more aggressive — allow up to 4h overflow
  remaining = stillRemaining;
  stillRemaining = [];
  const savedOverflow = ctx.overflowHours;
  ctx.overflowHours = 4;

  for (const slot of remaining) {
    let bestEmp = null;
    let bestScore = -Infinity;

    for (const emp of ctx.employees) {
      if (!isEligible(emp, slot, tracking, ctx, true)) continue;
      const score = computeScore(emp, slot, tracking, ctx);
      if (score > bestScore) {
        bestScore = score;
        bestEmp = emp;
      }
    }

    if (bestEmp) {
      assignToSlot(bestEmp, slot, tracking, weekStart);
    } else {
      stillRemaining.push(slot);
    }
  }

  ctx.overflowHours = savedOverflow;

  // Remaining are truly unfillable — create empty assignments
  for (const slot of stillRemaining) {
    tracking.assignments.push({
      week_start_date: weekStart,
      day_of_week: slot.day,
      shift_period: slot.period,
      slot_index: slot.slotIdx,
      employee_id: null,
      is_locked: false,
      start_time: slot.startTime,
      end_time: slot.endTime,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// Hour-maximizer pass: ensure employees reach their max_hours
// ═══════════════════════════════════════════════════════════════

function hourMaximizerPass(tracking, ctx, weekStart) {
  // Find employees significantly under their max_hours (gap >= 4h means a missed shift)
  const underUtilized = ctx.employees
    .filter(e => {
      const gap = e.max_hours - tracking.hoursUsed[e.id];
      return gap >= 4; // at least one more shift could fit
    })
    .sort((a, b) => {
      // Most under-utilized first
      const gapA = a.max_hours - tracking.hoursUsed[a.id];
      const gapB = b.max_hours - tracking.hoursUsed[b.id];
      return gapB - gapA;
    });

  if (underUtilized.length === 0) return;

  // First: try to fill any empty slots with under-utilized employees
  const emptyAssignments = tracking.assignments.filter(a => !a.employee_id);
  for (const empty of emptyAssignments) {
    const slot = {
      day: empty.day_of_week,
      period: empty.shift_period,
      slotIdx: empty.slot_index,
      startTime: empty.start_time,
      endTime: empty.end_time,
      hours: calcHours(empty.start_time, empty.end_time),
      isManagerSlot: empty.slot_index === 0 && empty.shift_period !== 'morning',
    };

    let bestEmp = null;
    let bestGap = -1;
    for (const emp of underUtilized) {
      if (isEligible(emp, slot, tracking, ctx, true)) {
        const gap = emp.max_hours - tracking.hoursUsed[emp.id];
        if (gap > bestGap) {
          bestGap = gap;
          bestEmp = emp;
        }
      }
    }

    if (bestEmp) {
      // Fill the empty slot
      empty.employee_id = bestEmp.id;
      tracking.hoursUsed[bestEmp.id] += slot.hours;
      tracking.shiftsAssigned[bestEmp.id] += 1;
      tracking.daysAssigned[bestEmp.id].add(slot.day);
      tracking.dayEmployees[slot.day].add(bestEmp.id);
      const key = `${slot.day}-${slot.period}`;
      if (!tracking.dayPeriodAssignments[key]) tracking.dayPeriodAssignments[key] = [];
      tracking.dayPeriodAssignments[key].push(empty);
    }
  }

  // Second: try swapping over-utilized employees with under-utilized ones
  // Find assignments where the current employee is at/over their target
  // and an under-utilized employee could take the slot instead
  const underUtilizedRefresh = ctx.employees
    .filter(e => (e.max_hours - tracking.hoursUsed[e.id]) >= 4)
    .sort((a, b) => (b.max_hours - tracking.hoursUsed[b.id]) - (a.max_hours - tracking.hoursUsed[a.id]));

  for (const emp of underUtilizedRefresh) {
    if (emp.max_hours - tracking.hoursUsed[emp.id] < 4) continue;

    // Find slots where the current assignee is over their max or could give up this slot
    for (const assignment of tracking.assignments) {
      if (!assignment.employee_id || assignment.is_locked) continue;
      if (assignment.employee_id === emp.id) continue;

      const currentHolder = ctx.employees.find(e => e.id === assignment.employee_id);
      if (!currentHolder) continue;

      // Only swap if current holder is at/over their max hours
      // and emp is under-utilized
      const holderUsed = tracking.hoursUsed[currentHolder.id];
      const slotHours = calcHours(assignment.start_time, assignment.end_time);
      const holderAfterRemoval = holderUsed - slotHours;

      // Current holder should still be at/above their ideal after giving up this slot
      if (holderAfterRemoval < currentHolder.max_hours - slotHours) continue;
      // Only swap if holder is over max (with overflow) and emp is well under
      if (holderUsed <= currentHolder.max_hours && (emp.max_hours - tracking.hoursUsed[emp.id]) < slotHours) continue;

      const slot = {
        day: assignment.day_of_week,
        period: assignment.shift_period,
        slotIdx: assignment.slot_index,
        startTime: assignment.start_time,
        endTime: assignment.end_time,
        hours: slotHours,
        isManagerSlot: assignment.slot_index === 0 && assignment.shift_period !== 'morning',
      };

      // Check if emp can take this slot
      if (!isEligible(emp, slot, tracking, ctx, true)) continue;

      // Do the swap: remove from current holder, give to emp
      tracking.hoursUsed[currentHolder.id] -= slotHours;
      tracking.shiftsAssigned[currentHolder.id] -= 1;
      tracking.daysAssigned[currentHolder.id].delete(slot.day);
      tracking.dayEmployees[slot.day].delete(currentHolder.id);

      assignment.employee_id = emp.id;
      tracking.hoursUsed[emp.id] += slotHours;
      tracking.shiftsAssigned[emp.id] += 1;
      tracking.daysAssigned[emp.id].add(slot.day);
      tracking.dayEmployees[slot.day].add(emp.id);

      const key = `${slot.day}-${slot.period}`;
      const periodArr = tracking.dayPeriodAssignments[key] || [];
      const idx = periodArr.findIndex(a => a === assignment);
      if (idx !== -1) periodArr[idx] = assignment;

      if (emp.max_hours - tracking.hoursUsed[emp.id] < 4) break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Warning generation
// ═══════════════════════════════════════════════════════════════

function generateWarnings(tracking, ctx) {
  const warnings = [];
  const allEntries = [...tracking.assignments, ...ctx.lockedEntries];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Overflow warnings
  for (const emp of ctx.employees) {
    const used = tracking.hoursUsed[emp.id] || 0;
    if (used > emp.max_hours) {
      const over = (used - emp.max_hours).toFixed(1).replace(/\.0$/, '');
      warnings.push(`${emp.name} assigned ${used.toFixed(1).replace(/\.0$/, '')}h (max ${emp.max_hours}h, +${over}h overflow)`);
    }
  }

  // Tight availability warnings
  for (const emp of ctx.employees) {
    const ideal = getIdealShiftCount(emp);
    const assigned = tracking.shiftsAssigned[emp.id] || 0;
    if (assigned < ideal && assigned < 2) {
      // Count how many days they're eligible for at least one slot
      let eligibleDays = 0;
      for (let day = 0; day < 7; day++) {
        if (emp.employment_type === 'external_coop' && day !== 0 && day !== 6) continue;
        const hasSlot = ctx.allSlots.some(s => {
          if (s.day !== day || s.isLocked) return false;
          return isEmployeeAvailable(emp, ctx.unavailMap, ctx.oldAvailMap, day, s.startTime, s.endTime, s.period);
        });
        if (hasSlot) eligibleDays++;
      }
      if (eligibleDays <= 2) {
        warnings.push(`${emp.name} has limited availability — eligible on only ${eligibleDays} of 7 days`);
      }
    }
  }

  // Per-shift warnings
  for (let day = 0; day < 7; day++) {
    for (const period of ['morning', 'afternoon', 'night']) {
      const shiftEntries = allEntries.filter(
        a => a.day_of_week === day && a.shift_period === period && a.employee_id
      );
      if (shiftEntries.length === 0) continue;

      const hasNonTrainee = shiftEntries.some(a => {
        const emp = ctx.employees.find(e => e.id === a.employee_id);
        return emp && !emp.is_trainee;
      });
      if (!hasNonTrainee) {
        warnings.push(`${dayNames[day]} ${period} shift has only trainees`);
      }

      const hasManager = shiftEntries.some(a => {
        const emp = ctx.employees.find(e => e.id === a.employee_id);
        return emp && emp.roles && emp.roles.includes(`${period}_manager`);
      });
      if (!hasManager) {
        warnings.push(`${dayNames[day]} ${period} shift has no manager assigned`);
      }

      if (period === 'night') {
        const hasMale = shiftEntries.some(a => {
          const emp = ctx.employees.find(e => e.id === a.employee_id);
          return emp && emp.gender === 'male';
        });
        if (!hasMale) {
          warnings.push(`${dayNames[day]} night shift has no male employee`);
        }
      }
    }
  }

  // Unfilled slot warnings
  const emptySlots = tracking.assignments.filter(a => !a.employee_id);
  if (emptySlots.length > 0) {
    const byDay = {};
    for (const a of emptySlots) {
      const key = `${dayNames[a.day_of_week]} ${a.shift_period}`;
      byDay[key] = (byDay[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(byDay)) {
      warnings.push(`${key} has ${count} unfilled slot(s)`);
    }
  }

  return warnings;
}

// ═══════════════════════════════════════════════════════════════
// Main scheduling function
// ═══════════════════════════════════════════════════════════════

async function autoGenerate(weekStart, { overflowHours = 0 } = {}) {
  // ═══ STEP 1: Load data ═══
  const rawEmployees = await db('employees').where({ active: true });
  const employees = rawEmployees.map(emp => {
    let roles = [];
    try { roles = JSON.parse(emp.role || '[]'); } catch { roles = emp.role ? [emp.role] : []; }
    return { ...emp, roles };
  });
  const lockedShifts = await db('locked_shifts');
  const shiftConfigs = await db('shift_configs').orderBy(['shift_period', 'slot_index']);
  const existingSettings = await db('schedule_settings').where({ week_start_date: weekStart });

  let unavailableTimes = [];
  try {
    unavailableTimes = await db('unavailable_times')
      .where(function () {
        this.whereNull('week_start_date').orWhere({ week_start_date: weekStart });
      });
  } catch (e) { /* Table may not exist */ }

  let oldAvailability = [];
  try { oldAvailability = await db('availability'); } catch (e) { /* ignore */ }

  let orderDaysRows = [];
  try { orderDaysRows = await db('order_days'); } catch (e) { /* Table may not exist */ }

  const orderDaysMap = { ag: [], us: [] };
  for (const row of orderDaysRows) {
    orderDaysMap[row.order_type].push(row.day_of_week);
  }

  const unavailMap = {};
  for (const u of unavailableTimes) {
    if (!unavailMap[u.employee_id]) unavailMap[u.employee_id] = [];
    unavailMap[u.employee_id].push(u);
  }

  const oldAvailMap = {};
  for (const a of oldAvailability) {
    if (!oldAvailMap[a.employee_id]) oldAvailMap[a.employee_id] = {};
    oldAvailMap[a.employee_id][`${a.day_of_week}-${a.shift_period}`] = a.is_available;
  }

  const slotCounts = {};
  for (const period of ['morning', 'afternoon', 'night']) {
    slotCounts[period] = shiftConfigs.filter(c => c.shift_period === period).length;
  }

  const settingsMap = {};
  for (const s of existingSettings) {
    settingsMap[`${s.day_of_week}-${s.shift_period}`] = s.employee_count;
  }

  // Derive standard shift durations from configs
  const standardDurations = [...new Set(shiftConfigs.map(c => calcHours(c.start_time, c.end_time)))]
    .sort((a, b) => b - a);

  // ═══ STEP 2: Clear existing schedule ═══
  await db('schedules').where({ week_start_date: weekStart }).del();

  // ═══ STEP 3: Place locked shifts ═══
  const lockedByDayPeriod = {};
  for (const ls of lockedShifts) {
    const key = `${ls.day_of_week}-${ls.shift_period}`;
    if (!lockedByDayPeriod[key]) lockedByDayPeriod[key] = [];
    lockedByDayPeriod[key].push(ls);
  }

  const lockedEntries = [];
  for (const key of Object.keys(lockedByDayPeriod)) {
    const [dayStr, ...periodParts] = key.split('-');
    const day = parseInt(dayStr);
    const period = periodParts.join('-');
    const periodConfigs = shiftConfigs.filter(c => c.shift_period === period);
    const slotsNeeded = settingsMap[key] || slotCounts[period];
    const entries = lockedByDayPeriod[key];

    entries.sort((a, b) => {
      const empA = employees.find(e => e.id === a.employee_id);
      const empB = employees.find(e => e.id === b.employee_id);
      const aM = empA && empA.roles.some(r => r.endsWith('_manager'));
      const bM = empB && empB.roles.some(r => r.endsWith('_manager'));
      return (bM ? 1 : 0) - (aM ? 1 : 0);
    });

    const usedSlots = new Set();
    for (const ls of entries) {
      const emp = employees.find(e => e.id === ls.employee_id);
      if (!emp) continue;

      let bestSlot = null;
      const isManager = emp.roles.includes(`${period}_manager`);

      for (let slotIdx = 0; slotIdx < slotsNeeded; slotIdx++) {
        if (usedSlots.has(slotIdx)) continue;
        const config = periodConfigs[slotIdx] || periodConfigs[periodConfigs.length - 1];
        if (isManager && MANAGER_START_TIMES[period] && MANAGER_START_TIMES[period].includes(config.start_time)) {
          bestSlot = { slotIdx, config };
          break;
        }
      }
      if (!bestSlot) {
        for (let slotIdx = 0; slotIdx < slotsNeeded; slotIdx++) {
          if (usedSlots.has(slotIdx)) continue;
          const config = periodConfigs[slotIdx] || periodConfigs[periodConfigs.length - 1];
          bestSlot = { slotIdx, config };
          break;
        }
      }

      if (bestSlot) {
        usedSlots.add(bestSlot.slotIdx);
        lockedEntries.push({
          week_start_date: weekStart,
          day_of_week: day,
          shift_period: period,
          slot_index: bestSlot.slotIdx,
          employee_id: ls.employee_id,
          is_locked: true,
          start_time: bestSlot.config.start_time,
          end_time: bestSlot.config.end_time,
        });
      }
    }
  }

  if (lockedEntries.length > 0) {
    await db('schedules').insert(lockedEntries);
  }

  // ═══ STEP 4: Build all slots and initialize tracking ═══
  const allSlots = buildAllSlots(shiftConfigs, settingsMap, slotCounts, lockedEntries);

  const tracking = {
    hoursUsed: {},
    shiftsAssigned: {},
    daysAssigned: {},
    dayEmployees: {},
    dayPeriodAssignments: {},
    assignments: [],
  };

  employees.forEach(e => {
    tracking.hoursUsed[e.id] = 0;
    tracking.shiftsAssigned[e.id] = 0;
    tracking.daysAssigned[e.id] = new Set();
  });

  for (let day = 0; day < 7; day++) {
    tracking.dayEmployees[day] = new Set();
  }

  // Account for locked shifts
  for (const entry of lockedEntries) {
    if (entry.employee_id) {
      const hours = calcHours(entry.start_time, entry.end_time);
      tracking.hoursUsed[entry.employee_id] = (tracking.hoursUsed[entry.employee_id] || 0) + hours;
      tracking.shiftsAssigned[entry.employee_id] = (tracking.shiftsAssigned[entry.employee_id] || 0) + 1;
      if (!tracking.daysAssigned[entry.employee_id]) tracking.daysAssigned[entry.employee_id] = new Set();
      tracking.daysAssigned[entry.employee_id].add(entry.day_of_week);
      tracking.dayEmployees[entry.day_of_week].add(entry.employee_id);

      const key = `${entry.day_of_week}-${entry.shift_period}`;
      if (!tracking.dayPeriodAssignments[key]) tracking.dayPeriodAssignments[key] = [];
      tracking.dayPeriodAssignments[key].push(entry);
    }
  }

  // Context object passed to scoring/eligibility functions
  const ctx = {
    employees,
    unavailMap,
    oldAvailMap,
    orderDaysMap,
    lockedEntries,
    standardDurations,
    overflowHours,
    allSlots,
    empEligibleSlotCount: {}, // pre-computed: how many total slots each employee can fill
  };

  // Get open (non-locked) slots
  const openSlots = allSlots.filter(s => !s.isLocked);

  // Pre-compute how many slots each employee is eligible for (scarcity measure)
  // Employees who can only fill a few slots should get priority
  for (const emp of employees) {
    let count = 0;
    for (const slot of openSlots) {
      if (isEmployeeAvailable(emp, unavailMap, oldAvailMap, slot.day, slot.startTime, slot.endTime, slot.period)) {
        // Basic availability check (not full eligibility — just time-based)
        if (emp.employment_type === 'external_coop' && slot.day !== 0 && slot.day !== 6) continue;
        if (emp.is_trainee && slot.period === 'morning' && slot.startTime === '06:00') continue;
        count++;
      }
    }
    ctx.empEligibleSlotCount[emp.id] = count;
  }

  // ═══ STEP 5: Pre-assign food order employees ═══
  preAssignFoodOrders(openSlots, tracking, ctx, weekStart);

  // ═══ STEP 6: Main greedy loop — most constrained slot first ═══
  const deferredSlots = [];

  while (openSlots.length > 0) {
    // Compute difficulty for each open slot
    for (const slot of openSlots) {
      let count = 0;
      for (const emp of employees) {
        if (isEligible(emp, slot, tracking, ctx, false)) count++;
      }
      slot.eligibleCount = count;
    }

    // Sort by constraint priority
    openSlots.sort(slotPriorityComparator);

    const targetSlot = openSlots[0];

    if (targetSlot.eligibleCount === 0) {
      // No one can fill this in strict mode — defer to backfill
      deferredSlots.push(openSlots.shift());
      continue;
    }

    // Score all eligible employees
    let bestEmp = null;
    let bestScore = -Infinity;

    for (const emp of employees) {
      if (!isEligible(emp, targetSlot, tracking, ctx, false)) continue;
      const score = computeScore(emp, targetSlot, tracking, ctx);
      if (score > bestScore) {
        bestScore = score;
        bestEmp = emp;
      }
    }

    if (bestEmp) {
      assignToSlot(bestEmp, targetSlot, tracking, weekStart);
    } else {
      // Shouldn't happen (eligibleCount > 0) but just in case
      deferredSlots.push(targetSlot);
    }

    openSlots.shift();
  }

  // ═══ STEP 7: Relaxed backfill ═══
  if (deferredSlots.length > 0) {
    relaxedBackfill(deferredSlots, tracking, ctx, weekStart);
  }

  // ═══ STEP 7B: Hour-maximizer pass ═══
  // Find employees under their max_hours and try to swap them into empty slots
  // or slots held by over-utilized employees
  hourMaximizerPass(tracking, ctx, weekStart);

  // ═══ STEP 8: Save to DB ═══
  if (tracking.assignments.length > 0) {
    const batchSize = 50;
    for (let i = 0; i < tracking.assignments.length; i += batchSize) {
      await db('schedules').insert(tracking.assignments.slice(i, i + batchSize));
    }
  }

  // ═══ STEP 9: Warnings ═══
  const warnings = generateWarnings(tracking, ctx);

  return { success: true, assignments_count: tracking.assignments.length, warnings };
}

module.exports = { autoGenerate, isEmployeeAvailable, timesOverlap };
