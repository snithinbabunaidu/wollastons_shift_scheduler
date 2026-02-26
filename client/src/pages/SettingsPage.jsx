import { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Button, Stack, Alert, Divider,
  Checkbox,
} from '@mui/material';
import { Add, Remove, RestartAlt, Save, Link as LinkIcon, ContentCopy, CheckCircle, LinkOff } from '@mui/icons-material';
import * as api from '../services/api';

const PERIODS = ['morning', 'afternoon', 'night'];
const PERIOD_LABELS = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatTimeForDisplay(time24) {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}:00 ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function calcHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return (endMin - startMin) / 60;
}

export default function SettingsPage() {
  const [configs, setConfigs] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [orderDays, setOrderDays] = useState({ ag: [], us: [] });
  const [orderDaysDirty, setOrderDaysDirty] = useState(false);
  const [inviteToken, setInviteToken] = useState(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);

  const loadConfigs = async () => {
    try {
      const res = await api.getShiftConfigs();
      setConfigs(res.data);
      setDirty(false);
    } catch (err) {
      console.error(err);
    }
  };

  const loadOrderDays = async () => {
    try {
      const res = await api.getOrderDays();
      setOrderDays(res.data);
      setOrderDaysDirty(false);
    } catch (err) {
      console.error(err);
    }
  };

  const loadInviteToken = async () => {
    try {
      const res = await api.getInviteToken();
      setInviteToken(res.data.token);
      setInviteUrl(res.data.url || '');
    } catch (err) {
      console.error(err);
    }
  };

  const handleGenerateInvite = async () => {
    setInviteLoading(true);
    try {
      const res = await api.generateInviteToken();
      setInviteToken(res.data.token);
      setInviteUrl(res.data.url);
      setSuccess('Registration link generated!');
    } catch (err) {
      setError('Failed to generate link');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleDeactivateInvite = async () => {
    if (!confirm('Deactivate the registration link? Employees won\'t be able to register until you generate a new one.')) return;
    try {
      await api.deactivateInviteToken();
      setInviteToken(null);
      setInviteUrl('');
      setSuccess('Registration link deactivated');
    } catch (err) {
      setError('Failed to deactivate link');
    }
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteUrl);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  useEffect(() => { loadConfigs(); loadOrderDays(); loadInviteToken(); }, []);

  const getPeriodsSlots = (period) =>
    configs.filter(c => c.shift_period === period).sort((a, b) => a.slot_index - b.slot_index);

  const updateField = (period, slotIndex, field, value) => {
    setConfigs(prev => prev.map(c =>
      c.shift_period === period && c.slot_index === slotIndex
        ? { ...c, [field]: value }
        : c
    ));
    setDirty(true);
  };

  const addSlot = (period) => {
    const slots = getPeriodsSlots(period);
    const last = slots[slots.length - 1];
    setConfigs(prev => [
      ...prev,
      {
        shift_period: period,
        slot_index: slots.length,
        start_time: last?.start_time || '06:00',
        end_time: last?.end_time || '13:00',
        is_default: false,
      },
    ]);
    setDirty(true);
  };

  const removeSlot = (period) => {
    const slots = getPeriodsSlots(period);
    if (slots.length <= 1) return;
    const lastIdx = slots[slots.length - 1].slot_index;
    setConfigs(prev => prev.filter(c => !(c.shift_period === period && c.slot_index === lastIdx)));
    setDirty(true);
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');
    try {
      const renumbered = [];
      for (const period of PERIODS) {
        const slots = getPeriodsSlots(period);
        slots.forEach((s, idx) => {
          renumbered.push({
            shift_period: period,
            slot_index: idx,
            start_time: s.start_time,
            end_time: s.end_time,
          });
        });
      }
      await api.updateShiftConfigs(renumbered);
      setSuccess('Shift configuration saved successfully');
      setDirty(false);
      loadConfigs();
    } catch (err) {
      setError('Failed to save configuration');
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset all shift times to defaults?')) return;
    try {
      await api.resetShiftConfigs();
      setSuccess('Reset to defaults');
      loadConfigs();
    } catch (err) {
      setError('Reset failed');
    }
  };

  const toggleOrderDay = (type, day) => {
    setOrderDays(prev => {
      const current = prev[type] || [];
      const updated = current.includes(day)
        ? current.filter(d => d !== day)
        : [...current, day].sort();
      return { ...prev, [type]: updated };
    });
    setOrderDaysDirty(true);
  };

  const handleSaveOrderDays = async () => {
    setError('');
    setSuccess('');
    try {
      await api.updateOrderDays(orderDays.ag, orderDays.us);
      setSuccess('Order days saved successfully');
      setOrderDaysDirty(false);
    } catch (err) {
      setError('Failed to save order days');
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5">Shift Configuration</Typography>
        <Stack direction="row" gap={1}>
          <Button variant="outlined" startIcon={<RestartAlt />} onClick={handleReset}>Reset to Defaults</Button>
          <Button variant="contained" startIcon={<Save />} onClick={handleSave} disabled={!dirty}>Save</Button>
        </Stack>
      </Stack>

      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {PERIODS.map(period => (
        <Paper key={period} sx={{ mb: 3, p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="h6">{PERIOD_LABELS[period]} Shift</Typography>
            <Stack direction="row" gap={1}>
              <Button size="small" startIcon={<Remove />} onClick={() => removeSlot(period)}
                disabled={getPeriodsSlots(period).length <= 1}>Remove Slot</Button>
              <Button size="small" startIcon={<Add />} onClick={() => addSlot(period)}>Add Slot</Button>
            </Stack>
          </Stack>
          <Divider sx={{ mb: 2 }} />
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Slot #</TableCell>
                  <TableCell>Start Time</TableCell>
                  <TableCell>End Time</TableCell>
                  <TableCell>Display</TableCell>
                  <TableCell>Hours</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {getPeriodsSlots(period).map((slot, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell>
                      <TextField
                        size="small" type="time" value={slot.start_time}
                        onChange={(e) => updateField(period, slot.slot_index, 'start_time', e.target.value)}
                        sx={{ width: 140 }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small" type="time" value={slot.end_time || ''}
                        onChange={(e) => updateField(period, slot.slot_index, 'end_time', e.target.value)}
                        sx={{ width: 140 }}
                      />
                    </TableCell>
                    <TableCell>
                      {formatTimeForDisplay(slot.start_time)} - {formatTimeForDisplay(slot.end_time)}
                    </TableCell>
                    <TableCell>{calcHours(slot.start_time, slot.end_time).toFixed(1)}h</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      ))}

      {/* Order Days Configuration */}
      <Paper sx={{ mb: 3, p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="h6">Order Days</Typography>
          <Button variant="contained" size="small" startIcon={<Save />} onClick={handleSaveOrderDays} disabled={!orderDaysDirty}>
            Save Order Days
          </Button>
        </Stack>
        <Divider sx={{ mb: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select which days are order days. On order days, the employee with the corresponding food order role
          will be automatically assigned to the first morning shift (6 AM opener) by the auto-scheduler.
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>Order Type</TableCell>
                {DAY_NAMES.map((d, i) => (
                  <TableCell key={i} align="center" sx={{ fontWeight: 'bold' }}>{d}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold', color: 'success.main' }}>AG Food Order</TableCell>
                {DAY_NAMES.map((_, i) => (
                  <TableCell key={i} align="center" sx={{ p: 0.5 }}>
                    <Checkbox
                      size="small"
                      checked={orderDays.ag?.includes(i) || false}
                      onChange={() => toggleOrderDay('ag', i)}
                    />
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 'bold', color: 'primary.main' }}>US Food Order</TableCell>
                {DAY_NAMES.map((_, i) => (
                  <TableCell key={i} align="center" sx={{ p: 0.5 }}>
                    <Checkbox
                      size="small"
                      checked={orderDays.us?.includes(i) || false}
                      onChange={() => toggleOrderDay('us', i)}
                    />
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Employee Registration Link */}
      <Paper sx={{ mb: 3, p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="h6">
            <LinkIcon sx={{ mr: 1, verticalAlign: 'middle', color: '#6C63FF' }} />
            Employee Registration Link
          </Typography>
        </Stack>
        <Divider sx={{ mb: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Generate a shareable link for employees to register themselves and set their class schedules.
          After registering, each employee gets their own personal link to update their availability.
        </Typography>

        {inviteToken ? (
          <Box>
            <Box sx={{
              p: 1.5, borderRadius: 2, mb: 2,
              bgcolor: 'rgba(15, 15, 26, 0.6)',
              border: '1px solid rgba(108, 99, 255, 0.15)',
              wordBreak: 'break-all',
            }}>
              <Typography variant="body2" sx={{ color: '#8B83FF', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.75rem' }}>
                {inviteUrl}
              </Typography>
            </Box>
            <Stack direction="row" gap={1} flexWrap="wrap">
              <Button
                variant="contained" size="small"
                startIcon={inviteCopied ? <CheckCircle /> : <ContentCopy />}
                onClick={copyInviteLink}
                sx={{
                  background: inviteCopied
                    ? 'linear-gradient(135deg, #2ED573, #45B7D1)'
                    : 'linear-gradient(135deg, #6C63FF, #8B83FF)',
                }}
              >
                {inviteCopied ? 'Copied!' : 'Copy Link'}
              </Button>
              <Button variant="outlined" size="small" startIcon={<LinkIcon />}
                onClick={handleGenerateInvite} disabled={inviteLoading}
              >
                Regenerate
              </Button>
              <Button variant="outlined" size="small" startIcon={<LinkOff />}
                onClick={handleDeactivateInvite}
                sx={{ borderColor: 'rgba(255, 107, 107, 0.3)', color: '#FF6B6B', '&:hover': { borderColor: 'rgba(255, 107, 107, 0.5)', bgcolor: 'rgba(255, 107, 107, 0.08)' } }}
              >
                Deactivate
              </Button>
            </Stack>
          </Box>
        ) : (
          <Button
            variant="contained" startIcon={<LinkIcon />}
            onClick={handleGenerateInvite} disabled={inviteLoading}
            sx={{
              background: 'linear-gradient(135deg, #6C63FF, #8B83FF)',
              '&:hover': { background: 'linear-gradient(135deg, #5A52E0, #7A72F0)' },
            }}
          >
            {inviteLoading ? 'Generating...' : 'Generate Registration Link'}
          </Button>
        )}
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>About Shift Configuration</Typography>
        <Typography variant="body2" color="text.secondary">
          Configure the default time slots for each shift period. These times are used when generating
          new schedules and appear in the PDF export. You can also edit individual shift times directly
          on the schedule page by clicking the time chip on any cell.
        </Typography>
      </Paper>
    </Box>
  );
}
