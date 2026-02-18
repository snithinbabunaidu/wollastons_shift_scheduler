const db = require('../db/knex');

function calcHours(startTime, endTime) {
  if (!startTime || !endTime) return 7;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60; // overnight shift
  return (endMin - startMin) / 60;
}

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// Check if a shift slot [shiftStart, shiftEnd] overlaps with an unavailable block [blockStart, blockEnd]
function timesOverlap(shiftStart, shiftEnd, blockStart, blockEnd) {
  let ss = toMinutes(shiftStart);
  let se = toMinutes(shiftEnd);
  let bs = toMinutes(blockStart);
  let be = toMinutes(blockEnd);

  // Handle overnight shifts (end < start means crosses midnight)
  if (se <= ss) se += 24 * 60;
  if (be <= bs) be += 24 * 60;

  // Two ranges overlap if one starts before the other ends, and vice versa
  return ss < be && bs < se;
}

// Manager roles are restricted to specific opening times
const MANAGER_START_TIMES = {
  morning: ['06:00'],
  afternoon: ['11:00', '13:00'],
  night: ['18:00'],
};

// ═══════════════════════════════════════════════════════════════
// Phase 0 helpers: Pre-computation
// ═══════════════════════════════════════════════════════════════

function buildDaySlots(shiftConfigs, settingsMap, slotCounts, existingLocked) {
  const daySlots = [];
  for (let day = 0; day < 7; day++) {
    const slots = [];
    for (const period of ['morning', 'afternoon', 'night']) {
      const slotsNeeded = settingsMap[`${day}-${period}`] || slotCounts[period];
      const periodConfigs = shiftConfigs.filter(c => c.shift_period === period);

      for (let slotIdx = 0; slotIdx < slotsNeeded; slotIdx++) {
        const config = periodConfigs[slotIdx] || periodConfigs[periodConfigs.length - 1];
        const shiftHours = calcHours(config.start_time, config.end_time);
        // Only slot 0 per period is the designated manager slot
        const isManagerSlot = slotIdx === 0;

        const lockedEntry = existingLocked.find(
          e => e.day_of_week === day && e.shift_period === period && e.slot_index === slotIdx
        );

        slots.push({
          period,
          slotIdx,
          config,
          shiftHours,
          isManagerSlot,
          isLocked: !!lockedEntry,
          lockedEmployeeId: lockedEntry ? lockedEntry.employee_id : null,
        });
      }
    }
    daySlots.push(slots);
  }
  return daySlots;
}

// Check if an employee can work a specific slot
// Rules: slot 0 = manager slot (prefer managers there), slots 1+ = open to anyone
// Managers can work ANY slot in their period, non-managers can work any slot
// In strict mode: non-managers blocked from slot 0, managers restricted to their period
// In relaxed mode: anyone can fill any slot
function canEmployeeWorkSlot(emp, slot, relaxManager) {
  const hasAnyManagerRole = emp.roles.some(r => r.endsWith('_manager'));

  if (relaxManager) {
    // Relaxed: managers can work any slot in their period, non-managers can fill anything
    if (!hasAnyManagerRole) return true;
    // Managers: allow any slot in their manager period
    return emp.roles.some(r => {
      if (!r.endsWith('_manager')) return false;
      return r.replace('_manager', '') === slot.period;
    });
  }

  // Strict mode
  if (!hasAnyManagerRole) {
    // Non-managers can work any slot EXCEPT slot 0 (manager slot)
    if (slot.isManagerSlot) return false;
    return true;
  }

  // Managers can work ANY slot in their manager period
  return emp.roles.some(r => {
    if (!r.endsWith('_manager')) return false;
    return r.replace('_manager', '') === slot.period;
  });
}

// Build eligibility: for each employee, for each day, which slots can they fill?
function buildEligibilityMatrix(employees, daySlots, unavailMap, oldAvailMap) {
  const eligibility = {};
  for (const emp of employees) {
    eligibility[emp.id] = {};
    for (let day = 0; day < 7; day++) {
      // External coop: weekends only
      if (emp.employment_type === 'external_coop' && day !== 0 && day !== 6) {
        eligibility[emp.id][day] = { eligible: false, slots: [], minHours: Infinity, maxHours: 0, durations: new Set() };
        continue;
      }

      const availableSlots = [];
      for (const slot of daySlots[day]) {
        if (slot.isLocked) continue;
        if (!isEmployeeAvailable(emp, unavailMap, oldAvailMap, day, slot.config.start_time, slot.config.end_time, slot.period)) continue;
        if (!canEmployeeWorkSlot(emp, slot, false)) continue;
        availableSlots.push(slot);
      }

      // Also check relaxed manager slots (for backfill eligibility tracking)
      const relaxedSlots = [];
      for (const slot of daySlots[day]) {
        if (slot.isLocked) continue;
        if (!isEmployeeAvailable(emp, unavailMap, oldAvailMap, day, slot.config.start_time, slot.config.end_time, slot.period)) continue;
        if (!canEmployeeWorkSlot(emp, slot, true)) continue;
        relaxedSlots.push(slot);
      }

      const allSlots = relaxedSlots.length > 0 ? relaxedSlots : availableSlots;
      const durations = new Set(allSlots.map(s => s.shiftHours));

      const avgHours = allSlots.length > 0
        ? allSlots.reduce((sum, s) => sum + s.shiftHours, 0) / allSlots.length
        : 0;

      eligibility[emp.id][day] = {
        eligible: allSlots.length > 0,
        slots: availableSlots,
        relaxedSlots,
        minHours: allSlots.length > 0 ? Math.min(...allSlots.map(s => s.shiftHours)) : Infinity,
        maxHours: allSlots.length > 0 ? Math.max(...allSlots.map(s => s.shiftHours)) : 0,
        avgHours,
        durations,
      };
    }
  }
  return eligibility;
}

// ═══════════════════════════════════════════════════════════════
// Phase 1B: Day-level allocation with backtracking
// ═══════════════════════════════════════════════════════════════

function countEligibleForDay(day, employees, eligibility, daysAssigned, hoursUsed, shiftsAssigned) {
  let count = 0;
  for (const emp of employees) {
    if (daysAssigned[emp.id].has(day)) continue;
    if (!eligibility[emp.id][day].eligible) continue;
    // Use minHours for eligibility check (conservative: if they can fit the smallest shift, they're eligible)
    if (hoursUsed[emp.id] + eligibility[emp.id][day].minHours > emp.max_hours) continue;
    if (emp.employment_type === 'external_coop') {
      if (day !== 0 && day !== 6) continue;
      if (shiftsAssigned[emp.id] >= 2) continue;
    }
    count++;
  }
  return count;
}

function getRankedCandidatesForDay(day, employees, eligibility, daysAssigned, hoursUsed, shiftsAssigned, daySlots) {
  const candidates = [];
  for (const emp of employees) {
    if (daysAssigned[emp.id].has(day)) continue;
    if (!eligibility[emp.id][day].eligible) continue;
    const tentH = eligibility[emp.id][day].minHours;
    if (hoursUsed[emp.id] + tentH > emp.max_hours) continue;
    if (emp.employment_type === 'external_coop') {
      if (day !== 0 && day !== 6) continue;
      if (shiftsAssigned[emp.id] >= 2) continue;
    }

    // Score for day-level allocation
    let score = 0;

    // Scarcity: employees with fewer remaining eligible days get priority
    let eligibleDayCount = 0;
    for (let d = 0; d < 7; d++) {
      if (daysAssigned[emp.id].has(d)) continue;
      if (!eligibility[emp.id][d].eligible) continue;
      if (hoursUsed[emp.id] + eligibility[emp.id][d].minHours > emp.max_hours) continue;
      if (emp.employment_type === 'external_coop' && d !== 0 && d !== 6) continue;
      eligibleDayCount++;
    }
    if (eligibleDayCount > 0) {
      score += 500 / eligibleDayCount;
    }

    // Manager eligible for a manager slot on this day
    const hasManagerSlotOnDay = daySlots[day].some(s => s.isManagerSlot && !s.isLocked &&
      canEmployeeWorkSlot(emp, s, false));
    if (hasManagerSlotOnDay) score += 300;

    // Remaining capacity as a fraction of max (treats 13/20 and 26/40 equally)
    const remaining = emp.max_hours - hoursUsed[emp.id];
    score += (remaining / emp.max_hours) * 100;

    // Spread: penalize employees already working many days
    if (shiftsAssigned[emp.id] >= 5) score -= 300;
    else if (shiftsAssigned[emp.id] >= 4) score -= 200;
    else if (shiftsAssigned[emp.id] >= 3) score -= 100;

    // Prefer employees who need this day to reach max hours
    const remainingAfterThisDay = remaining - tentH;
    if (remainingAfterThisDay >= 0 && remainingAfterThisDay <= 7) score += 50;

    // Boost employees with few slot type options (role-constrained)
    // e.g., morning-only managers can only fill 2 slots/day vs non-managers filling 8
    const totalEligibleSlotTypes = eligibility[emp.id][day].relaxedSlots
      ? eligibility[emp.id][day].relaxedSlots.length : eligibility[emp.id][day].slots.length;
    if (totalEligibleSlotTypes > 0 && totalEligibleSlotTypes <= 2) score += 100;

    // Non-managers: if they have very few future days left, prioritize now
    const isNonManager = !emp.roles.some(r => r.endsWith('_manager'));
    if (isNonManager) {
      let futureDays = 0;
      for (let d = 0; d < 7; d++) {
        if (d === day) continue;
        if (daysAssigned[emp.id].has(d)) continue;
        if (!eligibility[emp.id][d].eligible) continue;
        if (hoursUsed[emp.id] + tentH + eligibility[emp.id][d].minHours > emp.max_hours) continue;
        futureDays++;
      }
      if (futureDays <= 1) score += 100;
    }

    candidates.push({ emp, score, tentativeHours: tentH });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function checkFeasibility(dayAllocation, slotsPerDay, employees, eligibility, daysAssigned, hoursUsed, shiftsAssigned, daySlots) {
  for (let day = 0; day < 7; day++) {
    const remaining = slotsPerDay[day] - dayAllocation[day].length;
    if (remaining <= 0) continue;
    const eligible = countEligibleForDay(day, employees, eligibility, daysAssigned, hoursUsed, shiftsAssigned);
    if (eligible < remaining) return false;

    // Structural check: morning non-manager slots can ONLY be filled by non-managers
    if (daySlots) {
      const allocatedIds = new Set(dayAllocation[day]);
      const morningNonMgrSlots = daySlots[day].filter(s =>
        s.period === 'morning' && !s.isManagerSlot && !s.isLocked
      ).length;
      // Count how many allocated employees are non-managers who can do morning
      const allocatedNonMgrMorning = dayAllocation[day].filter(id => {
        const emp = employees.find(e => e.id === id);
        return emp && !emp.roles.some(r => r.endsWith('_manager'));
      }).length;
      const remainingMorningNonMgr = morningNonMgrSlots - allocatedNonMgrMorning;
      if (remainingMorningNonMgr > 0) {
        // Count unallocated non-managers eligible for this day
        const availableNonMgrs = employees.filter(emp => {
          if (allocatedIds.has(emp.id)) return false;
          if (daysAssigned[emp.id].has(day)) return false;
          if (emp.roles.some(r => r.endsWith('_manager'))) return false;
          if (!eligibility[emp.id][day].eligible) return false;
          if (hoursUsed[emp.id] + eligibility[emp.id][day].minHours > emp.max_hours) return false;
          if (emp.employment_type === 'external_coop') {
            if (day !== 0 && day !== 6) return false;
            if (shiftsAssigned[emp.id] >= 2) return false;
          }
          return true;
        }).length;
        if (availableNonMgrs < remainingMorningNonMgr) return false;
      }
    }
  }
  return true;
}

function allocateEmployeesToDays(dayAllocation, slotsPerDay, employees, daySlots, eligibility,
  hoursUsed, shiftsAssigned, daysAssigned) {
  const BACKTRACK_LIMIT = 500;
  let backtracks = 0;

  // Dynamically pick the most constrained day at each step
  // Total slots to fill across all days
  const totalToFill = slotsPerDay.reduce((sum, s, day) => sum + s - dayAllocation[day].length, 0);

  for (let step = 0; step < totalToFill; step++) {
    if (backtracks >= BACKTRACK_LIMIT) break;

    // Find the most constrained day dynamically
    let bestDay = -1;
    let bestSlack = Infinity;
    for (let day = 0; day < 7; day++) {
      const remaining = slotsPerDay[day] - dayAllocation[day].length;
      if (remaining <= 0) continue;
      const eligible = countEligibleForDay(day, employees, eligibility, daysAssigned, hoursUsed, shiftsAssigned);
      const slack = eligible - remaining;
      if (slack < bestSlack) {
        bestSlack = slack;
        bestDay = day;
      }
    }

    if (bestDay === -1) break; // All days filled

    const day = bestDay;
    const candidates = getRankedCandidatesForDay(day, employees, eligibility, daysAssigned, hoursUsed, shiftsAssigned, daySlots);

    let assigned = false;
    for (const candidate of candidates) {
      const emp = candidate.emp;
      const tentH = candidate.tentativeHours;

      // Tentatively assign using average hours (more realistic than min)
      dayAllocation[day].push(emp.id);
      daysAssigned[emp.id].add(day);
      hoursUsed[emp.id] += tentH;
      shiftsAssigned[emp.id] += 1;

      if (checkFeasibility(dayAllocation, slotsPerDay, employees, eligibility, daysAssigned, hoursUsed, shiftsAssigned, daySlots)) {
        assigned = true;
        break;
      }

      // Undo
      dayAllocation[day].pop();
      daysAssigned[emp.id].delete(day);
      hoursUsed[emp.id] -= tentH;
      shiftsAssigned[emp.id] -= 1;
      backtracks++;

      if (backtracks >= BACKTRACK_LIMIT) break;
    }

    if (!assigned) {
      // Try without feasibility check — better to assign someone than leave empty
      if (candidates.length > 0) {
        const emp = candidates[0].emp;
        const tentH = candidates[0].tentativeHours;
        dayAllocation[day].push(emp.id);
        daysAssigned[emp.id].add(day);
        hoursUsed[emp.id] += tentH;
        shiftsAssigned[emp.id] += 1;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Phase 1C: Hour budget optimization (knapsack per employee)
// ═══════════════════════════════════════════════════════════════

function optimizeHourBudgets(dayAllocation, employees, _daySlots, eligibility) {
  const targetHours = {};

  for (const emp of employees) {
    targetHours[emp.id] = {};

    // Find which days this employee is allocated to
    const allocatedDays = [];
    for (let day = 0; day < 7; day++) {
      if (dayAllocation[day].includes(emp.id)) {
        allocatedDays.push(day);
      }
    }

    if (allocatedDays.length === 0) continue;

    // Get possible durations for each allocated day
    const dayDurations = allocatedDays.map(day => {
      const elig = eligibility[emp.id][day];
      // Use relaxed slots to get all possible durations
      const allSlots = elig.relaxedSlots && elig.relaxedSlots.length > 0 ? elig.relaxedSlots : elig.slots;
      const durations = [...new Set(allSlots.map(s => s.shiftHours))];
      return durations.length > 0 ? durations : [5]; // fallback
    });

    // Enumerate all combos to find best sum <= max_hours
    const maxH = emp.max_hours;
    let bestCombo = null;
    let bestSum = 0;

    function enumerate(idx, currentSum, currentCombo) {
      if (idx === dayDurations.length) {
        if (currentSum <= maxH && currentSum > bestSum) {
          bestSum = currentSum;
          bestCombo = [...currentCombo];
        }
        return;
      }
      for (const dur of dayDurations[idx]) {
        if (currentSum + dur > maxH) continue;
        currentCombo.push(dur);
        enumerate(idx + 1, currentSum + dur, currentCombo);
        currentCombo.pop();
      }
    }

    enumerate(0, 0, []);

    if (bestCombo) {
      for (let i = 0; i < allocatedDays.length; i++) {
        targetHours[emp.id][allocatedDays[i]] = bestCombo[i];
      }
    } else {
      // Fallback: just use min hours for each day
      for (const day of allocatedDays) {
        targetHours[emp.id][day] = eligibility[emp.id][day].minHours || 5;
      }
    }
  }

  return targetHours;
}

// ═══════════════════════════════════════════════════════════════
// Phase 2: Slot assignment (within each day)
// ═══════════════════════════════════════════════════════════════

function computeSlotScore(emp, slot, day, dayAssignments, employees, lockedMap, orderDaysMap, targetHours, hoursUsed) {
  let score = 0;
  const { period, slotIdx, shiftHours, isManagerSlot } = slot;
  const isManagerForPeriod = emp.roles.includes(`${period}_manager`);

  // Locked shift bonus
  if (lockedMap[`${emp.id}-${day}-${period}`]) score += 1000;

  // Manager for manager-designated slot
  if (isManagerSlot && isManagerForPeriod) score += 500;

  // Food order on order day, first morning slot
  if (period === 'morning' && slotIdx === 0) {
    if (orderDaysMap.ag.includes(day) && emp.roles.includes('ag_food_order')) score += 600;
    if (orderDaysMap.us.includes(day) && emp.roles.includes('us_food_order')) score += 600;
  }

  // Food order employees boost for any morning slot
  if (period === 'morning' && (emp.roles.includes('ag_food_order') || emp.roles.includes('us_food_order'))) {
    score += 400;
  }

  // Non-trainee bonus when none yet in this period for the day
  const nonTraineeInShift = dayAssignments.some(
    a => a.shift_period === period && a.employee_id &&
      employees.find(e => e.id === a.employee_id && !e.is_trainee)
  );
  if (!nonTraineeInShift && !emp.is_trainee) score += 300;

  // Target hours match bonus (from Phase 1C) — strong bonus to honor the knapsack plan
  if (targetHours[emp.id] && targetHours[emp.id][day] === shiftHours) score += 400;
  // Penalty for deviating from target hours (prevents wasting 5h slots on non-target employees)
  if (targetHours[emp.id] && targetHours[emp.id][day] && targetHours[emp.id][day] !== shiftHours) score -= 100;

  // Perfect fit bonus
  const hoursAfter = hoursUsed[emp.id] + shiftHours;
  if (hoursAfter === emp.max_hours) score += 150;

  // Remaining capacity factor
  score += (emp.max_hours - hoursUsed[emp.id]) / emp.max_hours * 100;

  // Trainee penalty
  if (emp.is_trainee) score -= 50;

  return score;
}

function assignSlotsForDay(day, allocatedEmpIds, daySlotsList, employees, hoursUsed,
  lockedMap, orderDaysMap, targetHours, _existingLocked, weekStart, unavailMap, oldAvailMap) {
  const assignments = [];
  const empMap = {};
  for (const emp of employees) empMap[emp.id] = emp;

  // First, add locked slots
  for (const slot of daySlotsList) {
    if (slot.isLocked && slot.lockedEmployeeId) {
      assignments.push({
        week_start_date: weekStart,
        day_of_week: day,
        shift_period: slot.period,
        slot_index: slot.slotIdx,
        employee_id: slot.lockedEmployeeId,
        is_locked: true,
        start_time: slot.config.start_time,
        end_time: slot.config.end_time,
      });
    }
  }

  const openSlots = daySlotsList.filter(s => !s.isLocked);
  const lockedEmpIds = new Set(daySlotsList.filter(s => s.isLocked && s.lockedEmployeeId).map(s => s.lockedEmployeeId));
  const unassignedEmps = allocatedEmpIds.filter(id => !lockedEmpIds.has(id)).map(id => empMap[id]).filter(Boolean);

  // Build all (employee, slot) pairs with scores
  const pairs = [];
  for (const emp of unassignedEmps) {
    for (const slot of openSlots) {
      // Check if employee can work this slot
      if (!isEmployeeAvailable(emp, unavailMap, oldAvailMap, day, slot.config.start_time, slot.config.end_time, slot.period)) continue;
      if (!canEmployeeWorkSlot(emp, slot, false)) continue;
      if (hoursUsed[emp.id] + slot.shiftHours > emp.max_hours) continue;

      const score = computeSlotScore(emp, slot, day, assignments, employees, lockedMap, orderDaysMap, targetHours, hoursUsed);
      pairs.push({ emp, slot, score });
    }
  }

  // Greedy matching: sort by score desc, assign greedily
  pairs.sort((a, b) => b.score - a.score);

  const assignedEmps = new Set();
  const filledSlots = new Set();

  for (const { emp, slot } of pairs) {
    if (assignedEmps.has(emp.id)) continue;
    const slotKey = `${slot.period}-${slot.slotIdx}`;
    if (filledSlots.has(slotKey)) continue;

    assignments.push({
      week_start_date: weekStart,
      day_of_week: day,
      shift_period: slot.period,
      slot_index: slot.slotIdx,
      employee_id: emp.id,
      is_locked: false,
      start_time: slot.config.start_time,
      end_time: slot.config.end_time,
    });

    hoursUsed[emp.id] += slot.shiftHours;
    assignedEmps.add(emp.id);
    filledSlots.add(slotKey);
  }

  // Relaxed pass: fill any remaining open slots with relaxed manager rules
  for (const slot of openSlots) {
    const slotKey = `${slot.period}-${slot.slotIdx}`;
    if (filledSlots.has(slotKey)) continue;

    // Try all employees (not just allocated ones) with relaxed rules
    let bestEmp = null;
    let bestScore = -Infinity;

    for (const emp of employees) {
      if (assignedEmps.has(emp.id)) continue;
      // Check one-shift-per-day: not already assigned today
      const alreadyToday = assignments.some(a => a.employee_id === emp.id);
      if (alreadyToday) continue;
      if (!isEmployeeAvailable(emp, unavailMap, oldAvailMap, day, slot.config.start_time, slot.config.end_time, slot.period)) continue;
      if (!canEmployeeWorkSlot(emp, slot, true)) continue; // relaxed
      if (hoursUsed[emp.id] + slot.shiftHours > emp.max_hours) continue;
      if (emp.employment_type === 'external_coop') {
        if (day !== 0 && day !== 6) continue;
      }

      const score = computeSlotScore(emp, slot, day, assignments, employees, lockedMap, orderDaysMap, targetHours, hoursUsed);
      if (score > bestScore) {
        bestScore = score;
        bestEmp = emp;
      }
    }

    if (bestEmp) {
      assignments.push({
        week_start_date: weekStart,
        day_of_week: day,
        shift_period: slot.period,
        slot_index: slot.slotIdx,
        employee_id: bestEmp.id,
        is_locked: false,
        start_time: slot.config.start_time,
        end_time: slot.config.end_time,
      });
      hoursUsed[bestEmp.id] += slot.shiftHours;
      assignedEmps.add(bestEmp.id);
      filledSlots.add(slotKey);
    } else {
      // Still empty — add empty assignment
      assignments.push({
        week_start_date: weekStart,
        day_of_week: day,
        shift_period: slot.period,
        slot_index: slot.slotIdx,
        employee_id: null,
        is_locked: false,
        start_time: slot.config.start_time,
        end_time: slot.config.end_time,
      });
    }
  }

  return assignments;
}

// ═══════════════════════════════════════════════════════════════
// Main scheduling function (two-phase algorithm)
// ═══════════════════════════════════════════════════════════════

async function autoGenerate(weekStart) {
  // ═══ Data Loading (same as original) ═══
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
  } catch (e) {
    // Table may not exist yet
  }

  let oldAvailability = [];
  try {
    oldAvailability = await db('availability');
  } catch (e) {
    // ignore
  }

  let orderDaysRows = [];
  try {
    orderDaysRows = await db('order_days');
  } catch (e) {
    // Table may not exist yet
  }
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

  const lockedMap = {};
  for (const ls of lockedShifts) {
    lockedMap[`${ls.employee_id}-${ls.day_of_week}-${ls.shift_period}`] = true;
  }

  const slotCounts = {};
  for (const period of ['morning', 'afternoon', 'night']) {
    slotCounts[period] = shiftConfigs.filter(c => c.shift_period === period).length;
  }

  const settingsMap = {};
  for (const s of existingSettings) {
    settingsMap[`${s.day_of_week}-${s.shift_period}`] = s.employee_count;
  }

  // Clear ALL existing schedule entries for this week (we'll recreate locked ones)
  await db('schedules').where({ week_start_date: weekStart }).del();

  // Create locked schedule entries from locked_shifts table
  // Each locked_shifts entry specifies employee + day + period; assign them to the best slot
  const lockedByDayPeriod = {};
  for (const ls of lockedShifts) {
    const key = `${ls.day_of_week}-${ls.shift_period}`;
    if (!lockedByDayPeriod[key]) lockedByDayPeriod[key] = [];
    lockedByDayPeriod[key].push(ls);
  }

  const existingLocked = [];
  for (const key of Object.keys(lockedByDayPeriod)) {
    const [dayStr, period] = key.split('-');
    const day = parseInt(dayStr);
    const periodConfigs = shiftConfigs.filter(c => c.shift_period === period);
    const slotsNeeded = settingsMap[key] || slotCounts[period];
    const entries = lockedByDayPeriod[key];

    // Sort locked entries: managers first (they need specific start times)
    entries.sort((a, b) => {
      const empA = employees.find(e => e.id === a.employee_id);
      const empB = employees.find(e => e.id === b.employee_id);
      const aManager = empA && empA.roles.some(r => r.endsWith('_manager'));
      const bManager = empB && empB.roles.some(r => r.endsWith('_manager'));
      return (bManager ? 1 : 0) - (aManager ? 1 : 0);
    });

    const usedSlots = new Set();
    for (const ls of entries) {
      const emp = employees.find(e => e.id === ls.employee_id);
      if (!emp) continue;

      // Find best slot for this employee in this period
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
      // If no manager slot found or not a manager, take any open slot
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
        const entry = {
          week_start_date: weekStart,
          day_of_week: day,
          shift_period: period,
          slot_index: bestSlot.slotIdx,
          employee_id: ls.employee_id,
          is_locked: true,
          start_time: bestSlot.config.start_time,
          end_time: bestSlot.config.end_time,
        };
        existingLocked.push(entry);
      }
    }
  }

  // Insert all locked entries into DB
  if (existingLocked.length > 0) {
    await db('schedules').insert(existingLocked);
  }

  // Build set of employees who have locked shifts
  const lockedEmployeeIds = new Set(lockedShifts.map(ls => ls.employee_id));

  // ═══ PHASE 0: Pre-computation ═══
  const daySlots = buildDaySlots(shiftConfigs, settingsMap, slotCounts, existingLocked);
  // All employees participate in allocation (locked employees have their locked hours pre-counted)
  const eligibility = buildEligibilityMatrix(employees, daySlots, unavailMap, oldAvailMap);

  // Initialize tracking
  const hoursUsed = {};
  const shiftsAssigned = {};
  const daysAssigned = {};
  employees.forEach(e => {
    hoursUsed[e.id] = 0;
    shiftsAssigned[e.id] = 0;
    daysAssigned[e.id] = new Set();
  });

  // Account for locked schedule entries (pre-count their hours)
  for (const entry of existingLocked) {
    if (entry.employee_id) {
      const hours = calcHours(entry.start_time, entry.end_time);
      hoursUsed[entry.employee_id] = (hoursUsed[entry.employee_id] || 0) + hours;
      shiftsAssigned[entry.employee_id] = (shiftsAssigned[entry.employee_id] || 0) + 1;
      daysAssigned[entry.employee_id] = daysAssigned[entry.employee_id] || new Set();
      daysAssigned[entry.employee_id].add(entry.day_of_week);
    }
  }

  // Calculate slots per day
  const slotsPerDay = [];
  for (let day = 0; day < 7; day++) {
    slotsPerDay.push(daySlots[day].length);
  }

  // ═══ PHASE 1A: Mandatory pre-assignments ═══
  const dayAllocation = Array.from({ length: 7 }, () => []);

  // Locked employees are already in the schedule — add them to dayAllocation
  for (const entry of existingLocked) {
    if (entry.employee_id && !dayAllocation[entry.day_of_week].includes(entry.employee_id)) {
      dayAllocation[entry.day_of_week].push(entry.employee_id);
    }
  }

  // ═══ PHASE 1B: Day-level allocation with backtracking ═══
  // All employees participate; locked employees already have their locked days/hours counted
  const phase1Hours = { ...hoursUsed };
  const phase1Shifts = { ...shiftsAssigned };
  const phase1Days = {};
  for (const emp of employees) {
    phase1Days[emp.id] = new Set(daysAssigned[emp.id]);
  }

  allocateEmployeesToDays(dayAllocation, slotsPerDay, employees, daySlots, eligibility,
    phase1Hours, phase1Shifts, phase1Days);

  // ═══ PHASE 1C: Hour budget optimization ═══
  const targetHours = optimizeHourBudgets(dayAllocation, employees, daySlots, eligibility);

  // ═══ PHASE 2: Slot assignment ═══
  // Reset hoursUsed to only locked hours (Phase 1 used tentative values)
  employees.forEach(e => { hoursUsed[e.id] = 0; });
  for (const entry of existingLocked) {
    if (entry.employee_id) {
      const hours = calcHours(entry.start_time, entry.end_time);
      hoursUsed[entry.employee_id] = (hoursUsed[entry.employee_id] || 0) + hours;
    }
  }

  const allAssignments = [];
  for (let day = 0; day < 7; day++) {
    // Pass all employees but filter out locked employees from this day's allocated list
    // (their locked slots are already in DB, but they can fill open slots too)
    const allocatedForDay = dayAllocation[day].filter(id => !lockedEmployeeIds.has(id) || !existingLocked.some(e => e.employee_id === id && e.day_of_week === day));
    const dayAssignments = assignSlotsForDay(
      day, allocatedForDay, daySlots[day], employees, hoursUsed,
      lockedMap, orderDaysMap, targetHours, existingLocked, weekStart, unavailMap, oldAvailMap
    );
    // Filter out locked entries (they're already in DB)
    const nonLocked = dayAssignments.filter(a => !a.is_locked);
    allAssignments.push(...nonLocked);
  }

  // ═══ Final Backfill: catch any remaining empty slots ═══
  const emptyIndices = [];
  for (let i = 0; i < allAssignments.length; i++) {
    if (allAssignments[i].employee_id === null) emptyIndices.push(i);
  }

  // Sort empty slots by shortest shift first
  emptyIndices.sort((a, b) => {
    const aHrs = calcHours(allAssignments[a].start_time, allAssignments[a].end_time);
    const bHrs = calcHours(allAssignments[b].start_time, allAssignments[b].end_time);
    return aHrs - bHrs;
  });

  // Track who's assigned on each day for one-shift-per-day check
  const dayEmployees = {};
  for (let day = 0; day < 7; day++) dayEmployees[day] = new Set();
  for (const a of allAssignments) {
    if (a.employee_id) dayEmployees[a.day_of_week].add(a.employee_id);
  }
  for (const entry of existingLocked) {
    if (entry.employee_id) dayEmployees[entry.day_of_week].add(entry.employee_id);
  }

  for (const i of emptyIndices) {
    const a = allAssignments[i];
    const shiftHours = calcHours(a.start_time, a.end_time);
    const slot = {
      period: a.shift_period,
      slotIdx: a.slot_index,
      shiftHours,
      isManagerSlot: a.slot_index === 0,
      config: { start_time: a.start_time, end_time: a.end_time },
    };

    let bestEmp = null;
    let bestScore = -Infinity;

    for (const emp of employees) {
      if (dayEmployees[a.day_of_week].has(emp.id)) continue;
      if (!isEmployeeAvailable(emp, unavailMap, oldAvailMap, a.day_of_week, a.start_time, a.end_time, a.shift_period)) continue;
      if (!canEmployeeWorkSlot(emp, slot, true)) continue; // fully relaxed
      if (hoursUsed[emp.id] + shiftHours > emp.max_hours) continue;
      if (emp.employment_type === 'external_coop') {
        if (a.day_of_week !== 0 && a.day_of_week !== 6) continue;
        // Count current weekend shifts
        let weekendCount = 0;
        for (const aa of allAssignments) {
          if (aa.employee_id === emp.id && (aa.day_of_week === 0 || aa.day_of_week === 6)) weekendCount++;
        }
        if (weekendCount >= 2) continue;
      }

      const score = computeSlotScore(emp, slot, a.day_of_week, allAssignments.filter(x => x.day_of_week === a.day_of_week),
        employees, lockedMap, orderDaysMap, targetHours, hoursUsed);
      if (score > bestScore) {
        bestScore = score;
        bestEmp = emp;
      }
    }

    if (bestEmp) {
      allAssignments[i].employee_id = bestEmp.id;
      hoursUsed[bestEmp.id] += shiftHours;
      dayEmployees[a.day_of_week].add(bestEmp.id);
    }
  }

  // Insert all non-locked assignments
  if (allAssignments.length > 0) {
    const batchSize = 50;
    for (let i = 0; i < allAssignments.length; i += batchSize) {
      await db('schedules').insert(allAssignments.slice(i, i + batchSize));
    }
  }

  // Generate warnings
  const warnings = generateWarnings(allAssignments, existingLocked, employees);

  return { success: true, assignments_count: allAssignments.length, warnings };
}

function isEmployeeAvailable(emp, unavailMap, oldAvailMap, day, shiftStartTime, shiftEndTime, period) {
  const empUnavail = unavailMap[emp.id];

  // If employee has time-based unavailable blocks, use them
  if (empUnavail && empUnavail.length > 0) {
    const dayBlocks = empUnavail.filter(u => u.day_of_week === day);
    // Employee is available if none of their unavailable blocks overlap with the shift
    for (const block of dayBlocks) {
      if (timesOverlap(shiftStartTime, shiftEndTime, block.start_time, block.end_time)) {
        return false; // Overlaps with an unavailable block
      }
    }
    return true;
  }

  // Fall back to old period-based availability
  if (oldAvailMap[emp.id]) {
    return oldAvailMap[emp.id][`${day}-${period}`] !== false;
  }

  // Default: available
  return true;
}

function generateWarnings(assignments, lockedEntries, employees) {
  const warnings = [];
  const allEntries = [...assignments, ...lockedEntries];

  for (let day = 0; day < 7; day++) {
    for (const period of ['morning', 'afternoon', 'night']) {
      const shiftEntries = allEntries.filter(
        a => a.day_of_week === day && a.shift_period === period && a.employee_id
      );

      if (shiftEntries.length === 0) continue;

      const hasNonTrainee = shiftEntries.some(a => {
        const emp = employees.find(e => e.id === a.employee_id);
        return emp && !emp.is_trainee;
      });

      if (!hasNonTrainee) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        warnings.push(`${dayNames[day]} ${period} shift has only trainees`);
      }

      // Check for at least one manager in this period
      const hasManager = shiftEntries.some(a => {
        const emp = employees.find(e => e.id === a.employee_id);
        return emp && emp.roles && emp.roles.includes(`${period}_manager`);
      });
      if (!hasManager) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        warnings.push(`${dayNames[day]} ${period} shift has no manager assigned`);
      }

      const emptySlots = shiftEntries.filter(a => !a.employee_id);
      if (emptySlots.length > 0) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        warnings.push(`${dayNames[day]} ${period} shift has ${emptySlots.length} unfilled slot(s)`);
      }
    }
  }

  return warnings;
}

module.exports = { autoGenerate, isEmployeeAvailable, timesOverlap };
