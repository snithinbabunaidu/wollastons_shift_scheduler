import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Select, MenuItem, FormControl, InputLabel,
  Checkbox, FormControlLabel, Chip, Stack, Alert,
} from '@mui/material';
import { Add, Edit, Delete, Lock, Schedule, Close } from '@mui/icons-material';
import * as api from '../services/api';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ROLES = [
  { value: 'morning_manager', label: 'Morning Manager' },
  { value: 'afternoon_manager', label: 'Afternoon Manager' },
  { value: 'night_manager', label: 'Night Manager' },
  { value: 'ag_food_order', label: 'AG Food Order' },
  { value: 'us_food_order', label: 'US Food Order' },
];

const EMP_TYPES = [
  { value: 'part_time', label: 'Part-Time (20h max)' },
  { value: 'coop', label: 'Co-op/OPT (40h max)' },
  { value: 'external_coop', label: 'External Co-op (20h max, Weekends + Night)' },
];

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [editDialog, setEditDialog] = useState(null);
  const [unavailDialog, setUnavailDialog] = useState(null);
  const [lockedDialog, setLockedDialog] = useState(null);
  const [error, setError] = useState('');

  const loadEmployees = async () => {
    try {
      const res = await api.getEmployees();
      setEmployees(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { loadEmployees(); }, []);

  // Employee form dialog
  const openAdd = () => {
    setEditDialog({
      mode: 'add',
      data: { name: '', employment_type: 'part_time', is_trainee: false, roles: [], max_hours: 20, gender: '' },
    });
  };

  const openEdit = (emp) => {
    setEditDialog({
      mode: 'edit',
      data: { ...emp, roles: emp.roles || [] },
    });
  };

  const handleSaveEmployee = async () => {
    setError('');
    const { mode, data } = editDialog;
    try {
      if (mode === 'add') {
        await api.createEmployee(data);
      } else {
        await api.updateEmployee(data.id, data);
      }
      setEditDialog(null);
      loadEmployees();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this employee?')) return;
    try {
      await api.deleteEmployee(id);
      loadEmployees();
    } catch (err) {
      console.error(err);
    }
  };

  // Unavailable times dialog (class schedule)
  const openUnavailable = async (emp) => {
    try {
      const res = await api.getUnavailableTimes(emp.id);
      setUnavailDialog({
        employeeId: emp.id,
        employeeName: emp.name,
        blocks: res.data,
        newBlock: { day_of_week: 0, start_time: '09:00', end_time: '10:00', label: '' },
      });
    } catch (err) {
      console.error(err);
    }
  };

  const addBlock = () => {
    setUnavailDialog(prev => ({
      ...prev,
      blocks: [...prev.blocks, {
        employee_id: prev.employeeId,
        day_of_week: prev.newBlock.day_of_week,
        start_time: prev.newBlock.start_time,
        end_time: prev.newBlock.end_time,
        label: prev.newBlock.label || null,
      }],
      newBlock: { day_of_week: prev.newBlock.day_of_week, start_time: '09:00', end_time: '10:00', label: '' },
    }));
  };

  const removeBlock = (idx) => {
    setUnavailDialog(prev => ({
      ...prev,
      blocks: prev.blocks.filter((_, i) => i !== idx),
    }));
  };

  const saveUnavailable = async () => {
    try {
      await api.updateUnavailableTimes(unavailDialog.employeeId, unavailDialog.blocks);
      setUnavailDialog(null);
    } catch (err) {
      console.error(err);
    }
  };

  // Locked shifts dialog
  const openLocked = async (emp) => {
    try {
      const res = await api.getLockedShifts(emp.id);
      setLockedDialog({ employeeId: emp.id, employeeName: emp.name, lockedShifts: res.data });
    } catch (err) {
      console.error(err);
    }
  };

  const toggleLocked = (day, period) => {
    setLockedDialog(prev => {
      const locked = [...prev.lockedShifts];
      const idx = locked.findIndex(l => l.day_of_week === day && l.shift_period === period);
      if (idx >= 0) {
        locked.splice(idx, 1);
      } else {
        locked.push({ employee_id: prev.employeeId, day_of_week: day, shift_period: period });
      }
      return { ...prev, lockedShifts: locked };
    });
  };

  const saveLocked = async () => {
    try {
      await api.updateLockedShifts(lockedDialog.employeeId, lockedDialog.lockedShifts);
      setLockedDialog(null);
    } catch (err) {
      console.error(err);
    }
  };

  const toggleRole = (roleValue) => {
    setEditDialog(prev => {
      const currentRoles = prev.data.roles || [];
      const newRoles = currentRoles.includes(roleValue)
        ? currentRoles.filter(r => r !== roleValue)
        : [...currentRoles, roleValue];
      return { ...prev, data: { ...prev.data, roles: newRoles } };
    });
  };

  const updateFormField = (field, value) => {
    setEditDialog(prev => {
      const data = { ...prev.data, [field]: value };
      if (field === 'employment_type') {
        data.max_hours = value === 'coop' ? 40 : value === 'external_coop' ? 20 : 20;
      }
      return { ...prev, data };
    });
  };

  // Group blocks by day for display
  const blocksByDay = {};
  if (unavailDialog) {
    for (let d = 0; d < 7; d++) blocksByDay[d] = [];
    for (const [idx, b] of unavailDialog.blocks.entries()) {
      if (blocksByDay[b.day_of_week]) {
        blocksByDay[b.day_of_week].push({ ...b, _idx: idx });
      }
    }
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h5" sx={{ fontSize: '1.3rem' }}>Employees</Typography>
          <Typography variant="body2" sx={{ color: '#6B6B80', fontSize: '0.8rem' }}>
            {employees.length} team member{employees.length !== 1 ? 's' : ''} active
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={openAdd}>Add Employee</Button>
      </Stack>

      <TableContainer component={Paper} sx={{
        background: 'rgba(26, 26, 46, 0.6)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(139, 131, 255, 0.08)',
      }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Max Hours</TableCell>
              <TableCell>Gender</TableCell>
              <TableCell>Trainee</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {employees.map((emp) => (
              <TableRow key={emp.id} hover sx={{ '&:hover': { bgcolor: 'rgba(108, 99, 255, 0.04)' } }}>
                <TableCell>
                  <Stack direction="row" alignItems="center" gap={1}>
                    <Box sx={{
                      width: 30, height: 30, borderRadius: 1.5,
                      background: emp.is_trainee ? 'rgba(69, 183, 209, 0.12)' : 'rgba(108, 99, 255, 0.12)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.75rem', fontWeight: 700,
                      color: emp.is_trainee ? '#45B7D1' : '#8B83FF',
                    }}>
                      {emp.name.charAt(0).toUpperCase()}
                    </Box>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{emp.name}</Typography>
                      {!!emp.is_trainee && (
                        <Typography variant="caption" sx={{ color: '#45B7D1', fontSize: '0.65rem', fontWeight: 500 }}>Trainee</Typography>
                      )}
                    </Box>
                  </Stack>
                </TableCell>
                <TableCell>
                  <Chip
                    label={emp.employment_type === 'part_time' ? 'Part-Time' : emp.employment_type === 'coop' ? 'Co-op/OPT' : 'External'}
                    size="small"
                    sx={{
                      fontSize: '0.7rem', height: 22,
                      background: emp.employment_type === 'coop' ? 'rgba(46, 213, 115, 0.1)' : emp.employment_type === 'external_coop' ? 'rgba(255, 165, 2, 0.1)' : 'rgba(108, 99, 255, 0.1)',
                      color: emp.employment_type === 'coop' ? '#2ED573' : emp.employment_type === 'external_coop' ? '#FFA502' : '#8B83FF',
                      border: `1px solid ${emp.employment_type === 'coop' ? 'rgba(46, 213, 115, 0.2)' : emp.employment_type === 'external_coop' ? 'rgba(255, 165, 2, 0.2)' : 'rgba(108, 99, 255, 0.2)'}`,
                    }}
                  />
                </TableCell>
                <TableCell>
                  {(emp.roles || []).length === 0
                    ? <Typography variant="body2" sx={{ color: '#6B6B80', fontSize: '0.8rem' }}>None</Typography>
                    : (emp.roles || []).map(r => (
                        <Chip
                          key={r}
                          label={ROLES.find(x => x.value === r)?.label || r}
                          size="small"
                          sx={{
                            mr: 0.5, mb: 0.25, fontSize: '0.68rem', height: 20,
                            background: 'rgba(139, 131, 255, 0.08)',
                            border: '1px solid rgba(139, 131, 255, 0.15)',
                          }}
                        />
                      ))
                  }
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', fontWeight: 500 }}>
                    {emp.max_hours}h
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: '0.85rem' }}>
                    {emp.gender === 'male' ? 'M' : emp.gender === 'female' ? 'F' : '\u2014'}
                  </Typography>
                </TableCell>
                <TableCell>
                  {emp.is_trainee ? (
                    <Chip label="Yes" size="small" sx={{ height: 20, fontSize: '0.65rem', background: 'rgba(69, 183, 209, 0.12)', color: '#45B7D1' }} />
                  ) : (
                    <Typography sx={{ color: '#6B6B80', fontSize: '0.85rem' }}>No</Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" gap={0.5} justifyContent="flex-end">
                    <IconButton size="small" onClick={() => openEdit(emp)} title="Edit" sx={{ color: '#8B83FF', '&:hover': { bgcolor: 'rgba(108, 99, 255, 0.08)' } }}><Edit fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={() => openUnavailable(emp)} title="Class Schedule" sx={{ color: '#FFA502', '&:hover': { bgcolor: 'rgba(255, 165, 2, 0.08)' } }}>
                      <Schedule fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => openLocked(emp)} title="Locked Shifts" sx={{ color: '#2ED573', '&:hover': { bgcolor: 'rgba(46, 213, 115, 0.08)' } }}><Lock fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={() => handleDelete(emp.id)} title="Delete" sx={{ color: '#FF6B6B', '&:hover': { bgcolor: 'rgba(255, 107, 107, 0.08)' } }}><Delete fontSize="small" /></IconButton>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {employees.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: '#6B6B80' }}>
                  No employees yet. Click "Add Employee" to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Add/Edit Employee Dialog */}
      <Dialog open={!!editDialog} onClose={() => setEditDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{editDialog?.mode === 'add' ? 'Add Employee' : 'Edit Employee'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField
            fullWidth label="Name" margin="normal"
            value={editDialog?.data.name || ''}
            onChange={(e) => updateFormField('name', e.target.value)}
            autoFocus
          />
          <FormControl fullWidth margin="normal">
            <InputLabel>Employment Type</InputLabel>
            <Select
              value={editDialog?.data.employment_type || 'part_time'}
              label="Employment Type"
              onChange={(e) => updateFormField('employment_type', e.target.value)}
            >
              {EMP_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth margin="normal">
            <InputLabel>Gender</InputLabel>
            <Select
              value={editDialog?.data.gender || ''}
              label="Gender"
              onChange={(e) => updateFormField('gender', e.target.value)}
            >
              <MenuItem value="male">Male</MenuItem>
              <MenuItem value="female">Female</MenuItem>
            </Select>
          </FormControl>
          <Box sx={{ mt: 2, mb: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Roles (select all that apply)
            </Typography>
            {ROLES.map(r => (
              <FormControlLabel
                key={r.value}
                control={
                  <Checkbox
                    checked={(editDialog?.data.roles || []).includes(r.value)}
                    onChange={() => toggleRole(r.value)}
                    size="small"
                  />
                }
                label={r.label}
                sx={{ display: 'block', ml: 0 }}
              />
            ))}
          </Box>
          <TextField
            fullWidth label="Max Hours/Week" type="number" margin="normal"
            value={editDialog?.data.max_hours || 20}
            onChange={(e) => updateFormField('max_hours', parseInt(e.target.value))}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={editDialog?.data.is_trainee || false}
                onChange={(e) => updateFormField('is_trainee', e.target.checked)}
              />
            }
            label="Trainee"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEmployee}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Unavailable Times / Class Schedule Dialog */}
      <Dialog open={!!unavailDialog} onClose={() => setUnavailDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle>Class Schedule: {unavailDialog?.employeeName}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Add the times when this employee is unavailable (e.g., class hours).
            The scheduler will only assign shifts that don't overlap with these blocks.
          </Typography>

          {/* Add new block form */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Add Unavailable Block</Typography>
            <Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap">
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Day</InputLabel>
                <Select
                  value={unavailDialog?.newBlock.day_of_week ?? 0}
                  label="Day"
                  onChange={(e) => setUnavailDialog(prev => ({
                    ...prev,
                    newBlock: { ...prev.newBlock, day_of_week: e.target.value },
                  }))}
                >
                  {DAY_NAMES.map((d, i) => <MenuItem key={i} value={i}>{d}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField
                size="small" type="time" label="From"
                value={unavailDialog?.newBlock.start_time || '09:00'}
                onChange={(e) => setUnavailDialog(prev => ({
                  ...prev,
                  newBlock: { ...prev.newBlock, start_time: e.target.value },
                }))}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 130 }}
              />
              <TextField
                size="small" type="time" label="To"
                value={unavailDialog?.newBlock.end_time || '10:00'}
                onChange={(e) => setUnavailDialog(prev => ({
                  ...prev,
                  newBlock: { ...prev.newBlock, end_time: e.target.value },
                }))}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 130 }}
              />
              <TextField
                size="small" label="Label (optional)" placeholder="e.g., Chemistry 101"
                value={unavailDialog?.newBlock.label || ''}
                onChange={(e) => setUnavailDialog(prev => ({
                  ...prev,
                  newBlock: { ...prev.newBlock, label: e.target.value },
                }))}
                sx={{ flex: 1, minWidth: 140 }}
              />
              <Button variant="contained" size="small" startIcon={<Add />} onClick={addBlock}>
                Add
              </Button>
            </Stack>
          </Paper>

          {/* Blocks grouped by day */}
          {blocksByDay && Object.entries(blocksByDay).map(([day, blocks]) => {
            if (blocks.length === 0) return null;
            return (
              <Box key={day} sx={{ mb: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                  {DAY_NAMES[parseInt(day)]}
                </Typography>
                <Stack spacing={0.5}>
                  {blocks.map(b => (
                    <Stack key={b._idx} direction="row" alignItems="center" gap={1}
                      sx={{ bgcolor: 'rgba(255, 165, 2, 0.06)', borderRadius: 2, px: 1.5, py: 0.5, border: '1px solid rgba(255, 165, 2, 0.12)' }}
                    >
                      <Chip
                        label={`${fmtTime(b.start_time)} - ${fmtTime(b.end_time)}`}
                        size="small" color="warning" variant="outlined"
                        sx={{ fontSize: '0.8rem' }}
                      />
                      {b.label && (
                        <Typography variant="body2" color="text.secondary">{b.label}</Typography>
                      )}
                      <Box sx={{ ml: 'auto' }}>
                        <IconButton size="small" onClick={() => removeBlock(b._idx)}>
                          <Close fontSize="small" />
                        </IconButton>
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            );
          })}

          {unavailDialog?.blocks.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
              No unavailable blocks yet. This employee is available all day, every day.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnavailDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveUnavailable}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Locked Shifts Dialog */}
      <Dialog open={!!lockedDialog} onClose={() => setLockedDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle>Locked Shifts: {lockedDialog?.employeeName}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Locked shifts guarantee this employee is scheduled for these specific day/shift combinations.
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell></TableCell>
                {DAY_SHORT.map((d, i) => <TableCell key={i} align="center">{d}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {['morning', 'afternoon', 'night'].map(period => (
                <TableRow key={period}>
                  <TableCell sx={{ fontWeight: 'bold' }}>
                    {{ morning: 'Morning', afternoon: 'Afternoon', night: 'Night' }[period]}
                  </TableCell>
                  {Array.from({ length: 7 }, (_, day) => {
                    const isLocked = lockedDialog?.lockedShifts.some(
                      l => l.day_of_week === day && l.shift_period === period
                    );
                    return (
                      <TableCell key={day} align="center">
                        <Checkbox
                          checked={isLocked || false}
                          onChange={() => toggleLocked(day, period)}
                          icon={<Lock sx={{ color: 'action.disabled' }} />}
                          checkedIcon={<Lock color="success" />}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLockedDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveLocked}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
