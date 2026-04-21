import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Button, Select, MenuItem, IconButton, Chip, Alert, Stack,
  Dialog, DialogTitle, DialogContent, DialogActions, Tooltip, CircularProgress,
  TextField, Popover, Card, CardContent, Divider, Paper, FormControl, InputLabel,
  Autocomplete, Slider,
} from '@mui/material';
import {
  ChevronLeft, ChevronRight, AutoFixHigh, PictureAsPdf, Save,
  Lock, Add, Remove, AccessTime, EventBusy, Close,
} from '@mui/icons-material';
import * as api from '../services/api';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PERIODS = ['morning', 'afternoon', 'night'];
const PERIOD_LABELS = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' };
const PERIOD_COLORS = {
  morning: 'rgba(255, 165, 2, 0.08)',
  afternoon: 'rgba(69, 183, 209, 0.08)',
  night: 'rgba(108, 99, 255, 0.08)',
};
const PERIOD_BORDER_COLORS = {
  morning: 'rgba(255, 165, 2, 0.2)',
  afternoon: 'rgba(69, 183, 209, 0.2)',
  night: 'rgba(108, 99, 255, 0.2)',
};
const PERIOD_ACCENT = {
  morning: '#FFA502',
  afternoon: '#45B7D1',
  night: '#8B83FF',
};

function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getWeekStart(date) {
  const d = typeof date === 'string' ? parseDate(date) : new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return formatLocalDate(d);
}

function getNextWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + 7); // next Sunday
  return formatLocalDate(d);
}

function fmt(time24) {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

function calcHours(startTime, endTime) {
  if (!startTime || !endTime) return 7;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return (endMin - startMin) / 60;
}

export default function SchedulePage() {
  const [weekStart, setWeekStart] = useState(getNextWeekStart());
  const [schedule, setSchedule] = useState({});
  const [shiftConfigs, setShiftConfigs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [slotCounts, setSlotCounts] = useState({});
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [availableEmps, setAvailableEmps] = useState({});
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [overflowHours, setOverflowHours] = useState(0);
  const overflowHoursRef = useRef(0);
  const [timeEditAnchor, setTimeEditAnchor] = useState(null);
  const [timeEditKey, setTimeEditKey] = useState(null);
  const [timeEditStart, setTimeEditStart] = useState('');
  const [timeEditEnd, setTimeEditEnd] = useState('');
  const [orderDays, setOrderDays] = useState({ ag: [], us: [] });
  const [weeklyAvailDialog, setWeeklyAvailDialog] = useState(null);

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const [schedRes, empRes, configRes, orderRes] = await Promise.all([
        api.getSchedule(weekStart),
        api.getEmployees(),
        api.getShiftConfigs(),
        api.getOrderDays().catch(() => ({ data: { ag: [], us: [] } })),
      ]);

      setEmployees(empRes.data);
      setShiftConfigs(configRes.data);
      setOrderDays(orderRes.data);

      const grid = {};
      for (const entry of schedRes.data.schedules) {
        const key = `${entry.day_of_week}-${entry.shift_period}-${entry.slot_index}`;
        grid[key] = entry;
      }
      setSchedule(grid);

      const counts = {};
      for (const period of PERIODS) {
        const defaultCount = configRes.data.filter(c => c.shift_period === period).length;
        for (let day = 0; day < 7; day++) {
          const setting = schedRes.data.settings.find(
            s => s.day_of_week === day && s.shift_period === period
          );
          counts[`${day}-${period}`] = setting ? setting.employee_count : defaultCount;
        }
      }
      setSlotCounts(counts);
      setDirty(false);
      setAvailableEmps({});
    } catch (err) {
      console.error('Failed to load schedule:', err);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  const changeWeek = (offset) => {
    const d = parseDate(weekStart);
    d.setDate(d.getDate() + offset * 7);
    setWeekStart(formatLocalDate(d));
  };

  const getEntryTimes = (day, period, slotIdx) => {
    const key = `${day}-${period}-${slotIdx}`;
    const entry = schedule[key];
    const config = shiftConfigs.find(c => c.shift_period === period && c.slot_index === slotIdx);
    return {
      start_time: entry?.start_time || config?.start_time || '',
      end_time: entry?.end_time || config?.end_time || '',
    };
  };

  const handleAssign = (day, period, slotIdx, employeeId) => {
    const key = `${day}-${period}-${slotIdx}`;
    const times = getEntryTimes(day, period, slotIdx);
    setSchedule(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        day_of_week: day,
        shift_period: period,
        slot_index: slotIdx,
        employee_id: employeeId || null,
        employee_name: employees.find(e => e.id === employeeId)?.name || null,
        is_trainee: employees.find(e => e.id === employeeId)?.is_trainee || false,
        start_time: times.start_time,
        end_time: times.end_time,
        is_locked: prev[key]?.is_locked || false,
      },
    }));
    setDirty(true);
    // Clear cached available employees so next dropdown open fetches fresh hours
    setAvailableEmps({});
  };

  const openTimeEdit = (event, day, period, slotIdx) => {
    const key = `${day}-${period}-${slotIdx}`;
    const times = getEntryTimes(day, period, slotIdx);
    setTimeEditAnchor(event.currentTarget);
    setTimeEditKey(key);
    setTimeEditStart(times.start_time);
    setTimeEditEnd(times.end_time);
  };

  const saveTimeEdit = () => {
    if (!timeEditKey) return;
    const parts = timeEditKey.split('-');
    const day = parseInt(parts[0]);
    const period = parts[1];
    const slotIdx = parseInt(parts[2]);

    setSchedule(prev => ({
      ...prev,
      [timeEditKey]: {
        ...prev[timeEditKey],
        day_of_week: day,
        shift_period: period,
        slot_index: slotIdx,
        start_time: timeEditStart,
        end_time: timeEditEnd,
        employee_id: prev[timeEditKey]?.employee_id || null,
        is_locked: prev[timeEditKey]?.is_locked || false,
      },
    }));
    setDirty(true);
    setTimeEditAnchor(null);
    setTimeEditKey(null);
  };

  const loadAvailable = async (day, period) => {
    const key = `${day}-${period}`;
    if (availableEmps[key]) return;
    try {
      const res = await api.getAvailableEmployees(weekStart, day, period);
      setAvailableEmps(prev => ({ ...prev, [key]: res.data }));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const assignments = Object.entries(schedule)
        .filter(([, s]) => s.day_of_week !== undefined)
        .map(([, s]) => ({
          day_of_week: s.day_of_week,
          shift_period: s.shift_period,
          slot_index: s.slot_index,
          employee_id: s.employee_id,
          is_locked: s.is_locked || false,
          start_time: s.start_time,
          end_time: s.end_time,
        }));
      await api.saveSchedule(weekStart, assignments);
      setDirty(false);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleAutoGenerate = () => {
    setOverflowHours(0);
    overflowHoursRef.current = 0;
    setConfirmDialog({
      title: 'Auto-Generate Schedule',
      message: 'auto-generate',
      onConfirm: async () => {
        setConfirmDialog(null);
        setGenerating(true);
        try {
          const res = await api.autoGenerateSchedule(weekStart, { overflowHours: overflowHoursRef.current });
          if (res.data.warnings?.length > 0) setWarnings(res.data.warnings);
          await loadSchedule();
        } catch (err) {
          console.error('Auto-generate failed:', err);
        } finally {
          setGenerating(false);
        }
      },
    });
  };

  const handleExportPDF = async () => {
    try {
      if (dirty) await handleSave();
      const res = await api.downloadPDF(weekStart);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `schedule-${weekStart}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF export failed:', err);
    }
  };

  const adjustSlotCount = async (day, period, delta) => {
    const key = `${day}-${period}`;
    const current = slotCounts[key] || 5;
    const newCount = Math.max(1, Math.min(10, current + delta));
    setSlotCounts(prev => ({ ...prev, [key]: newCount }));

    // When reducing, drop any schedule state entries for removed slot indices
    // so the next save sends a lower maxSlot and the server cleans up orphans.
    if (delta < 0) {
      setSchedule(prev => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          const entry = next[k];
          if (entry?.day_of_week === day && entry?.shift_period === period && entry?.slot_index >= newCount) {
            delete next[k];
          }
        }
        return next;
      });
      setDirty(true);
    }

    try {
      await api.updateScheduleSettings(weekStart, [
        { day_of_week: day, shift_period: period, employee_count: newCount },
      ]);
    } catch (err) {
      console.error(err);
    }
  };

  const toggleLock = (day, period, slotIdx) => {
    const key = `${day}-${period}-${slotIdx}`;
    setSchedule(prev => ({
      ...prev,
      [key]: { ...prev[key], is_locked: !prev[key]?.is_locked },
    }));
    setDirty(true);
  };

  // Weekly availability overrides
  const openWeeklyAvail = async () => {
    try {
      // Load base unavailable times + weekly overrides for all employees
      const [baseRes, overrideRes] = await Promise.all([
        Promise.all(employees.map(emp =>
          api.getUnavailableTimes(emp.id).then(r => ({ empId: emp.id, empName: emp.name, blocks: r.data }))
        )),
        api.getAllWeeklyOverrides(weekStart).catch(() => ({ data: [] })),
      ]);

      const baseByEmp = {};
      for (const { empId, empName, blocks } of baseRes) {
        baseByEmp[empId] = { name: empName, blocks };
      }

      setWeeklyAvailDialog({
        baseByEmp,
        overrides: overrideRes.data,
        newOverride: { employee_id: employees[0]?.id || '', day_of_week: 0, start_time: '09:00', end_time: '17:00', label: '' },
      });
    } catch (err) {
      console.error(err);
    }
  };

  const addWeeklyOverride = () => {
    setWeeklyAvailDialog(prev => ({
      ...prev,
      overrides: [...prev.overrides, {
        employee_id: prev.newOverride.employee_id,
        day_of_week: prev.newOverride.day_of_week,
        start_time: prev.newOverride.start_time,
        end_time: prev.newOverride.end_time,
        label: prev.newOverride.label || null,
        employee_name: employees.find(e => e.id === prev.newOverride.employee_id)?.name || '',
      }],
      newOverride: { ...prev.newOverride, start_time: '09:00', end_time: '17:00', label: '' },
    }));
  };

  const removeWeeklyOverride = (idx) => {
    setWeeklyAvailDialog(prev => ({
      ...prev,
      overrides: prev.overrides.filter((_, i) => i !== idx),
    }));
  };

  const saveWeeklyOverrides = async () => {
    try {
      // Group overrides by employee and save each
      const byEmp = {};
      for (const o of weeklyAvailDialog.overrides) {
        if (!byEmp[o.employee_id]) byEmp[o.employee_id] = [];
        byEmp[o.employee_id].push(o);
      }

      // Also clear overrides for employees who no longer have any
      for (const emp of employees) {
        if (!byEmp[emp.id]) byEmp[emp.id] = [];
      }

      await Promise.all(
        Object.entries(byEmp).map(([empId, blocks]) =>
          api.updateWeeklyUnavailable(parseInt(empId), weekStart, blocks)
        )
      );
      setWeeklyAvailDialog(null);
      setAvailableEmps({}); // Clear cached available employees
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
  }

  // Calculate employee hours for the week
  const employeeHours = {};
  for (const [, entry] of Object.entries(schedule)) {
    if (entry?.employee_id) {
      const times = getEntryTimes(entry.day_of_week, entry.shift_period, entry.slot_index);
      const hours = calcHours(times.start_time, times.end_time);
      employeeHours[entry.employee_id] = (employeeHours[entry.employee_id] || 0) + hours;
    }
  }

  // Build warnings
  const currentWarnings = [];
  for (let day = 0; day < 7; day++) {
    for (const period of PERIODS) {
      const count = slotCounts[`${day}-${period}`] || 5;
      const slotEntries = [];
      for (let i = 0; i < count; i++) {
        const entry = schedule[`${day}-${period}-${i}`];
        if (entry?.employee_id) slotEntries.push(entry);
      }
      if (slotEntries.length > 0) {
        const allTrainees = slotEntries.every(e => {
          const emp = employees.find(em => em.id === e.employee_id);
          return emp?.is_trainee;
        });
        if (allTrainees) {
          currentWarnings.push(`${DAY_NAMES[day]} ${PERIOD_LABELS[period]}: Only trainees assigned`);
        }
      }
    }
  }
  for (const [empId, hours] of Object.entries(employeeHours)) {
    const emp = employees.find(e => e.id === parseInt(empId));
    if (emp && hours > emp.max_hours) {
      currentWarnings.push(`${emp.name}: ${hours.toFixed(1)}h scheduled (max ${emp.max_hours}h)`);
    }
  }
  const allWarnings = [...warnings, ...currentWarnings.filter(w => !warnings.includes(w))];

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={1}>
        <Stack direction="row" alignItems="center" gap={0.5}>
          <IconButton onClick={() => changeWeek(-1)} sx={{
            background: 'rgba(108, 99, 255, 0.08)',
            '&:hover': { background: 'rgba(108, 99, 255, 0.15)' },
          }}><ChevronLeft /></IconButton>
          <Box sx={{ px: 2 }}>
            <Typography variant="h5" sx={{ fontSize: '1.3rem' }}>
              Week of{' '}
              <Box component="span" sx={{
                background: 'linear-gradient(135deg, #6C63FF, #45B7D1)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>{weekStart}</Box>
            </Typography>
          </Box>
          <IconButton onClick={() => changeWeek(1)} sx={{
            background: 'rgba(108, 99, 255, 0.08)',
            '&:hover': { background: 'rgba(108, 99, 255, 0.15)' },
          }}><ChevronRight /></IconButton>
        </Stack>
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Button variant="outlined" size="small" startIcon={<EventBusy />} onClick={openWeeklyAvail}>
            Availability
          </Button>
          <Button
            variant="outlined" size="small" startIcon={<AutoFixHigh />}
            onClick={handleAutoGenerate} disabled={generating}
            sx={{
              borderColor: 'rgba(46, 213, 115, 0.3)', color: '#2ED573',
              '&:hover': { borderColor: 'rgba(46, 213, 115, 0.5)', background: 'rgba(46, 213, 115, 0.08)' },
            }}
          >
            {generating ? 'Generating...' : 'Auto-Generate'}
          </Button>
          <Button variant="contained" size="small" startIcon={<Save />} onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="outlined" size="small" startIcon={<PictureAsPdf />} onClick={handleExportPDF}
            sx={{
              borderColor: 'rgba(255, 107, 107, 0.3)', color: '#FF6B6B',
              '&:hover': { borderColor: 'rgba(255, 107, 107, 0.5)', background: 'rgba(255, 107, 107, 0.08)' },
            }}
          >
            PDF
          </Button>
        </Stack>
      </Stack>

      {/* Warnings */}
      {allWarnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setWarnings([])}>
          <Typography variant="subtitle2">Schedule Warnings:</Typography>
          {allWarnings.map((w, i) => <Typography key={i} variant="body2">- {w}</Typography>)}
        </Alert>
      )}

      {/* Schedule Grid - Days as rows, Shifts as columns */}
      {Array.from({ length: 7 }, (_, day) => {
        const isAgOrderDay = orderDays.ag?.includes(day);
        const isUsOrderDay = orderDays.us?.includes(day);
        const dayDate = parseDate(weekStart);
        dayDate.setDate(dayDate.getDate() + day);
        const dateStr = `${String(dayDate.getMonth() + 1).padStart(2, '0')}/${String(dayDate.getDate()).padStart(2, '0')}`;

        return (
          <Card key={day} sx={{
            mb: 2,
            background: 'rgba(26, 26, 46, 0.6)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(139, 131, 255, 0.08)',
            transition: 'all 0.2s ease',
            '&:hover': { border: '1px solid rgba(139, 131, 255, 0.15)' },
          }}>
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              {/* Day header */}
              <Stack direction="row" alignItems="center" gap={1} mb={1}>
                <Typography variant="h6" sx={{ fontWeight: 700, minWidth: 100, fontSize: '1rem' }}>
                  {DAY_NAMES[day]} <Typography component="span" variant="body2" sx={{ color: '#6B6B80', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.72rem' }}>{dateStr}</Typography>
                </Typography>
                {isAgOrderDay && (
                  <Chip label="AG Order" size="small" sx={{
                    fontSize: '0.65rem', height: 20,
                    background: 'rgba(46, 213, 115, 0.12)', color: '#2ED573',
                    border: '1px solid rgba(46, 213, 115, 0.25)',
                  }} />
                )}
                {isUsOrderDay && (
                  <Chip label="US Order" size="small" sx={{
                    fontSize: '0.65rem', height: 20,
                    background: 'rgba(108, 99, 255, 0.12)', color: '#8B83FF',
                    border: '1px solid rgba(108, 99, 255, 0.25)',
                  }} />
                )}
                {/* Employee hours summary for this day */}
                <Box sx={{ ml: 'auto' }}>
                  <Typography variant="caption" color="text.secondary">
                    {(() => {
                      let dayTotal = 0;
                      for (const period of PERIODS) {
                        const count = slotCounts[`${day}-${period}`] || 5;
                        for (let i = 0; i < count; i++) {
                          const entry = schedule[`${day}-${period}-${i}`];
                          if (entry?.employee_id) {
                            const times = getEntryTimes(day, period, i);
                            dayTotal += calcHours(times.start_time, times.end_time);
                          }
                        }
                      }
                      return dayTotal > 0 ? `${dayTotal.toFixed(1)}h total` : '';
                    })()}
                  </Typography>
                </Box>
              </Stack>

              <Divider sx={{ mb: 1 }} />

              {/* Three column groups: Morning | Afternoon | Night */}
              <Box sx={{ display: 'flex', gap: 1.5 }}>
                {PERIODS.map(period => {
                  const count = slotCounts[`${day}-${period}`] || 5;

                  return (
                    <Box
                      key={period}
                      sx={{
                        flex: 1,
                        bgcolor: PERIOD_COLORS[period],
                        borderRadius: 2,
                        p: 1,
                        minWidth: 0,
                        border: `1px solid ${PERIOD_BORDER_COLORS[period]}`,
                      }}
                    >
                      {/* Period header with slot count adjuster */}
                      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
                        <Typography variant="subtitle2" sx={{
                          fontWeight: 700, fontSize: '0.78rem',
                          color: PERIOD_ACCENT[period],
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                          {PERIOD_LABELS[period]}
                        </Typography>
                        <Stack direction="row" alignItems="center" gap={0}>
                          <IconButton size="small" onClick={() => adjustSlotCount(day, period, -1)} sx={{ p: 0.15 }}>
                            <Remove sx={{ fontSize: 14 }} />
                          </IconButton>
                          <Typography variant="caption" sx={{ mx: 0.25 }}>{count}</Typography>
                          <IconButton size="small" onClick={() => adjustSlotCount(day, period, 1)} sx={{ p: 0.15 }}>
                            <Add sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Stack>
                      </Stack>

                      {/* Slots listed vertically */}
                      <Stack spacing={0.5}>
                        {Array.from({ length: count }, (_, slotIdx) => {
                          const cellKey = `${day}-${period}-${slotIdx}`;
                          const entry = schedule[cellKey];
                          const isLocked = entry?.is_locked;
                          const emp = entry?.employee_id ? employees.find(e => e.id === entry.employee_id) : null;
                          const isTrainee = emp?.is_trainee;
                          const times = getEntryTimes(day, period, slotIdx);
                          const hours = emp ? (employeeHours[emp.id] || 0) : 0;
                          const overHours = emp && hours > emp.max_hours;

                          const config = shiftConfigs.find(c => c.shift_period === period && c.slot_index === slotIdx);
                          const hasCustomTime = entry?.start_time && config &&
                            (entry.start_time !== config.start_time || entry.end_time !== config.end_time);

                          return (
                            <Box
                              key={slotIdx}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                bgcolor: isLocked ? 'rgba(46, 213, 115, 0.08)' : 'rgba(15, 15, 26, 0.4)',
                                borderRadius: 1.5,
                                p: 0.5,
                                border: overHours ? '1px solid rgba(255, 107, 107, 0.5)' : isLocked ? '1px solid rgba(46, 213, 115, 0.2)' : '1px solid rgba(139, 131, 255, 0.06)',
                                transition: 'all 0.15s ease',
                                '&:hover': { bgcolor: isLocked ? 'rgba(46, 213, 115, 0.12)' : 'rgba(15, 15, 26, 0.6)' },
                              }}
                            >
                              {/* Opening time */}
                              <Typography
                                variant="caption"
                                onClick={(e) => openTimeEdit(e, day, period, slotIdx)}
                                sx={{
                                  fontSize: '0.65rem',
                                  fontWeight: hasCustomTime ? 'bold' : 'normal',
                                  color: hasCustomTime ? 'secondary.main' : 'text.secondary',
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                  minWidth: 30,
                                  textAlign: 'center',
                                }}
                              >
                                {fmt(times.start_time)}
                              </Typography>

                              {/* Employee searchable select */}
                              <Autocomplete
                                size="small"
                                value={emp || null}
                                onChange={(_, newVal) => handleAssign(day, period, slotIdx, newVal?.id || '')}
                                onOpen={() => loadAvailable(day, period)}
                                options={(() => {
                                  const avail = availableEmps[`${day}-${period}`] || [];
                                  const availIds = new Set(avail.map(e => e.id));
                                  // Merge: available employees first (with hours info), then remaining employees
                                  const rest = employees.filter(e => !availIds.has(e.id));
                                  return [...avail, ...rest];
                                })()}
                                getOptionLabel={(opt) => opt?.name || ''}
                                isOptionEqualToValue={(opt, val) => opt?.id === val?.id}
                                renderOption={(props, option) => {
                                  const avail = availableEmps[`${day}-${period}`] || [];
                                  const availMatch = avail.find(e => e.id === option.id);
                                  const isAvailable = !!availMatch;
                                  const hoursLeft = availMatch?.hours_remaining;
                                  const isAssignedToday = availMatch?.is_assigned_today;
                                  return (
                                    <li {...props} key={option.id}>
                                      <Stack direction="row" alignItems="center" gap={0.5} sx={{ width: '100%', opacity: isAvailable && !isAssignedToday ? 1 : 0.4 }}>
                                        <Typography sx={{ fontSize: '0.8rem' }}>{option.name}</Typography>
                                        {!!option.is_trainee && <Chip label="T" size="small" sx={{ height: 16, fontSize: '0.6rem', background: 'rgba(69, 183, 209, 0.15)', color: '#45B7D1' }} />}
                                        {hoursLeft !== undefined && (
                                          <Chip
                                            label={`${hoursLeft.toFixed(0)}h left`}
                                            size="small"
                                            sx={{
                                              height: 16, fontSize: '0.6rem', ml: 'auto',
                                              background: hoursLeft <= 7 ? 'rgba(255, 165, 2, 0.15)' : 'rgba(46, 213, 115, 0.12)',
                                              color: hoursLeft <= 7 ? '#FFA502' : '#2ED573',
                                            }}
                                          />
                                        )}
                                        {isAssignedToday && (
                                          <Typography sx={{ fontSize: '0.6rem', color: '#FF6B6B', ml: 'auto', fontWeight: 600 }}>working today</Typography>
                                        )}
                                        {!isAvailable && avail.length > 0 && !isAssignedToday && (
                                          <Typography sx={{ fontSize: '0.6rem', color: '#6B6B80', ml: 'auto' }}>unavailable</Typography>
                                        )}
                                      </Stack>
                                    </li>
                                  );
                                }}
                                renderInput={(params) => (
                                  <TextField
                                    {...params}
                                    placeholder="Empty"
                                    sx={{ '& .MuiInputBase-input': { fontSize: '0.73rem', py: '2px !important' } }}
                                  />
                                )}
                                sx={{
                                  width: '85%',
                                  flexShrink: 1,
                                  minWidth: 0,
                                  '& .MuiAutocomplete-input': { p: '2px 4px !important' },
                                  '& .MuiOutlinedInput-root': { py: '1px' },
                                }}
                                clearOnEscape
                                openOnFocus
                                blurOnSelect
                              />

                              {/* Trainee indicator */}
                              {!!isTrainee && (
                                <Chip label="T" size="small" color="info" sx={{ height: 16, fontSize: '0.6rem', minWidth: 0, flexShrink: 0 }} />
                              )}

                              {/* Closing time */}
                              <Typography
                                variant="caption"
                                onClick={(e) => openTimeEdit(e, day, period, slotIdx)}
                                sx={{
                                  fontSize: '0.65rem',
                                  fontWeight: hasCustomTime ? 'bold' : 'normal',
                                  color: hasCustomTime ? 'secondary.main' : 'text.secondary',
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                  minWidth: 30,
                                  textAlign: 'center',
                                  ml: 'auto',
                                }}
                              >
                                {fmt(times.end_time)}
                              </Typography>

                              {/* Lock toggle */}
                              <Tooltip title={isLocked ? 'Unlock' : 'Lock'}>
                                <IconButton size="small" onClick={() => toggleLock(day, period, slotIdx)} sx={{ p: 0.15, flexShrink: 0 }}>
                                  <Lock sx={{ fontSize: 13, color: isLocked ? 'success.main' : 'action.disabled' }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          );
                        })}
                      </Stack>
                    </Box>
                  );
                })}
              </Box>
            </CardContent>
          </Card>
        );
      })}

      {/* Time Edit Popover */}
      <Popover
        open={!!timeEditAnchor}
        anchorEl={timeEditAnchor}
        onClose={() => setTimeEditAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 200 }}>
          <Typography variant="subtitle2">Edit Shift Time</Typography>
          <TextField
            label="Start Time"
            type="time"
            size="small"
            value={timeEditStart}
            onChange={(e) => setTimeEditStart(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="End Time"
            type="time"
            size="small"
            value={timeEditEnd}
            onChange={(e) => setTimeEditEnd(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <Typography variant="caption" color="text.secondary">
            Duration: {calcHours(timeEditStart, timeEditEnd).toFixed(1)}h
          </Typography>
          <Stack direction="row" gap={1}>
            <Button size="small" onClick={() => setTimeEditAnchor(null)}>Cancel</Button>
            <Button size="small" variant="contained" onClick={saveTimeEdit}>Apply</Button>
          </Stack>
        </Box>
      </Popover>

      {/* Confirm Dialog */}
      <Dialog open={!!confirmDialog} onClose={() => setConfirmDialog(null)}>
        <DialogTitle>{confirmDialog?.title}</DialogTitle>
        <DialogContent>
          {confirmDialog?.message === 'auto-generate' ? (
            <Box>
              <Typography sx={{ mb: 2 }}>
                This will fill empty slots based on availability and rules. Locked shifts are preserved.
              </Typography>
              <Typography variant="subtitle2" gutterBottom>
                Overflow Tolerance: {overflowHours}h
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Allow employees to exceed their max hours by up to this amount to fill remaining slots.
              </Typography>
              <Slider
                value={overflowHours}
                onChange={(_, val) => { setOverflowHours(val); overflowHoursRef.current = val; }}
                min={0} max={4} step={1}
                marks={[{ value: 0, label: '0h' }, { value: 1, label: '1h' }, { value: 2, label: '2h' }, { value: 3, label: '3h' }, { value: 4, label: '4h' }]}
                sx={{ mt: 1 }}
              />
            </Box>
          ) : (
            <Typography>{confirmDialog?.message}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={confirmDialog?.onConfirm}>Continue</Button>
        </DialogActions>
      </Dialog>

      {/* Weekly Availability Adjustments Dialog */}
      <Dialog open={!!weeklyAvailDialog} onClose={() => setWeeklyAvailDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle>Adjust Availability - Week of {weekStart}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Add one-time unavailable blocks for this week only (e.g., exams, appointments).
            These are in addition to each employee's regular class schedule.
          </Typography>

          {/* Show base class schedules summary */}
          {weeklyAvailDialog?.baseByEmp && Object.entries(weeklyAvailDialog.baseByEmp).map(([empId, empData]) => {
            if (empData.blocks.length === 0) return null;
            return (
              <Paper key={empId} variant="outlined" sx={{ p: 1, mb: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                  {empData.name} - Regular Schedule:
                </Typography>
                <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                  {empData.blocks.map((b, i) => (
                    <Chip
                      key={i}
                      label={`${DAY_NAMES[b.day_of_week]} ${fmt(b.start_time)}-${fmt(b.end_time)}${b.label ? ` (${b.label})` : ''}`}
                      size="small" variant="outlined" color="default"
                      sx={{ fontSize: '0.7rem' }}
                    />
                  ))}
                </Stack>
              </Paper>
            );
          })}

          {/* Add override form */}
          <Paper variant="outlined" sx={{ p: 2, my: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Add One-Time Unavailable Block</Typography>
            <Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap">
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Employee</InputLabel>
                <Select
                  value={weeklyAvailDialog?.newOverride.employee_id || ''}
                  label="Employee"
                  onChange={(e) => setWeeklyAvailDialog(prev => ({
                    ...prev,
                    newOverride: { ...prev.newOverride, employee_id: e.target.value },
                  }))}
                >
                  {employees.map(e => <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <InputLabel>Day</InputLabel>
                <Select
                  value={weeklyAvailDialog?.newOverride.day_of_week ?? 0}
                  label="Day"
                  onChange={(e) => setWeeklyAvailDialog(prev => ({
                    ...prev,
                    newOverride: { ...prev.newOverride, day_of_week: e.target.value },
                  }))}
                >
                  {DAY_NAMES.map((d, i) => <MenuItem key={i} value={i}>{d}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField
                size="small" type="time" label="From"
                value={weeklyAvailDialog?.newOverride.start_time || '09:00'}
                onChange={(e) => setWeeklyAvailDialog(prev => ({
                  ...prev,
                  newOverride: { ...prev.newOverride, start_time: e.target.value },
                }))}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 120 }}
              />
              <TextField
                size="small" type="time" label="To"
                value={weeklyAvailDialog?.newOverride.end_time || '17:00'}
                onChange={(e) => setWeeklyAvailDialog(prev => ({
                  ...prev,
                  newOverride: { ...prev.newOverride, end_time: e.target.value },
                }))}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 120 }}
              />
              <TextField
                size="small" label="Reason"
                value={weeklyAvailDialog?.newOverride.label || ''}
                onChange={(e) => setWeeklyAvailDialog(prev => ({
                  ...prev,
                  newOverride: { ...prev.newOverride, label: e.target.value },
                }))}
                sx={{ flex: 1, minWidth: 100 }}
              />
              <Button variant="contained" size="small" startIcon={<Add />} onClick={addWeeklyOverride}>
                Add
              </Button>
            </Stack>
          </Paper>

          {/* List of weekly overrides */}
          {weeklyAvailDialog?.overrides.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>This Week's Extra Unavailable Blocks:</Typography>
              <Stack spacing={0.5}>
                {weeklyAvailDialog.overrides.map((o, idx) => (
                  <Stack key={idx} direction="row" alignItems="center" gap={1}
                    sx={{ bgcolor: 'rgba(255, 107, 107, 0.06)', borderRadius: 2, px: 1.5, py: 0.5, border: '1px solid rgba(255, 107, 107, 0.12)' }}
                  >
                    <Chip label={o.employee_name || employees.find(e => e.id === o.employee_id)?.name || '?'}
                      size="small" color="error" variant="outlined" sx={{ fontSize: '0.75rem' }} />
                    <Chip label={DAY_NAMES[o.day_of_week]} size="small" variant="outlined" sx={{ fontSize: '0.75rem' }} />
                    <Typography variant="body2">
                      {fmt(o.start_time)} - {fmt(o.end_time)}
                    </Typography>
                    {o.label && <Typography variant="body2" color="text.secondary">({o.label})</Typography>}
                    <Box sx={{ ml: 'auto' }}>
                      <IconButton size="small" onClick={() => removeWeeklyOverride(idx)}>
                        <Close fontSize="small" />
                      </IconButton>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWeeklyAvailDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveWeeklyOverrides}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
