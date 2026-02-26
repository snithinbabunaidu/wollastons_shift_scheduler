import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert, Stack,
  Select, MenuItem, FormControl, InputLabel, FormControlLabel, Checkbox,
  IconButton, Chip, Divider, CircularProgress,
} from '@mui/material';
import { Add, Delete, Save, CheckCircle } from '@mui/icons-material';
import * as api from '../services/api';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EMP_TYPES = [
  { value: 'part_time', label: 'Part-Time', desc: '20h/week max' },
  { value: 'coop', label: 'Co-op / OPT', desc: '40h/week max' },
  { value: 'external_coop', label: 'External Co-op', desc: '20h/week, Weekends + Night only' },
];

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

export default function MySchedulePage() {
  const [searchParams] = useSearchParams();
  const editToken = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [employee, setEmployee] = useState(null);
  const [name, setName] = useState('');
  const [employmentType, setEmploymentType] = useState('part_time');
  const [gender, setGender] = useState('');
  const [isTrainee, setIsTrainee] = useState(false);
  const [blocks, setBlocks] = useState([]);
  const [newBlock, setNewBlock] = useState({ day_of_week: 1, start_time: '09:00', end_time: '10:00', label: '' });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!editToken) { setLoading(false); setNotFound(true); return; }

    api.getEmployeeByEditToken(editToken).then(res => {
      const emp = res.data.employee;
      setEmployee(emp);
      setName(emp.name);
      setEmploymentType(emp.employment_type);
      setGender(emp.gender || '');
      setIsTrainee(!!emp.is_trainee);
      setBlocks(res.data.unavailable_blocks.map(b => ({
        day_of_week: b.day_of_week,
        start_time: b.start_time,
        end_time: b.end_time,
        label: b.label || '',
      })));
    }).catch(() => {
      setNotFound(true);
    }).finally(() => setLoading(false));
  }, [editToken]);

  const addBlock = () => {
    if (!newBlock.start_time || !newBlock.end_time) return;
    setBlocks(prev => [...prev, { ...newBlock }]);
    setNewBlock(prev => ({ ...prev, label: '' }));
  };

  const removeBlock = (idx) => {
    setBlocks(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      // Update employee info
      await api.updateEmployeeByEditToken(editToken, {
        name: name.trim(),
        employment_type: employmentType,
        gender: gender || null,
        is_trainee: isTrainee,
      });

      // Update class schedule
      await api.updateUnavailableByEditToken(editToken, blocks);

      setSuccess('Your information has been saved!');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh"
        sx={{ background: '#0F0F1A' }}>
        <CircularProgress sx={{ color: '#6C63FF' }} />
      </Box>
    );
  }

  if (notFound) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" sx={{ px: 2, background: '#0F0F1A', backgroundImage: 'radial-gradient(ellipse at 50% 0%, rgba(108, 99, 255, 0.15) 0%, transparent 50%)' }}>
        <Card sx={{ maxWidth: 420, width: '100%', background: 'rgba(26, 26, 46, 0.7)', backdropFilter: 'blur(20px)', border: '1px solid rgba(139, 131, 255, 0.15)' }}>
          <CardContent sx={{ p: 4, textAlign: 'center' }}>
            <Brand />
            <Typography variant="h6" sx={{ mt: 2, color: '#FF6B6B' }}>Link Not Found</Typography>
            <Typography variant="body2" sx={{ mt: 1, color: '#9B9BB4' }}>
              This link is invalid or your account is no longer active.
            </Typography>
            <Typography variant="body2" sx={{ mt: 2, color: '#6B6B80' }}>
              Please contact your manager for assistance.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    );
  }

  // Group blocks by day for display
  const blocksByDay = {};
  DAY_NAMES.forEach((_, i) => { blocksByDay[i] = []; });
  blocks.forEach((b, idx) => {
    if (blocksByDay[b.day_of_week]) {
      blocksByDay[b.day_of_week].push({ ...b, _idx: idx });
    }
  });

  return (
    <Box display="flex" justifyContent="center" minHeight="100vh" sx={{
      px: 2, py: 4,
      background: '#0F0F1A',
      backgroundImage: 'radial-gradient(ellipse at 50% 0%, rgba(108, 99, 255, 0.15) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(255, 107, 107, 0.08) 0%, transparent 50%)',
    }}>
      <Box sx={{ maxWidth: 500, width: '100%' }}>
        {/* Header */}
        <Card sx={{ mb: 2, background: 'rgba(26, 26, 46, 0.7)', backdropFilter: 'blur(20px)', border: '1px solid rgba(139, 131, 255, 0.15)' }}>
          <CardContent sx={{ p: 3, textAlign: 'center' }}>
            <Brand />
            <Typography variant="h6" sx={{ mt: 1, color: '#E8E8F0', fontWeight: 600 }}>
              My Schedule
            </Typography>
            <Typography variant="body2" sx={{ color: '#6B6B80' }}>
              Update your information and class schedule
            </Typography>
          </CardContent>
        </Card>

        {success && <Alert severity="success" sx={{ mb: 2 }} icon={<CheckCircle />}>{success}</Alert>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* Personal Info */}
        <Card sx={{ mb: 2, background: 'rgba(26, 26, 46, 0.7)', backdropFilter: 'blur(20px)', border: '1px solid rgba(139, 131, 255, 0.15)' }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2, color: '#E8E8F0' }}>
              Personal Information
            </Typography>

            <TextField
              fullWidth label="Your Name" value={name}
              onChange={(e) => setName(e.target.value)}
              required
              sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Employment Type</InputLabel>
              <Select value={employmentType} label="Employment Type"
                onChange={(e) => setEmploymentType(e.target.value)}
                sx={{ borderRadius: 2 }}
              >
                {EMP_TYPES.map(t => (
                  <MenuItem key={t.value} value={t.value}>
                    <Stack>
                      <Typography sx={{ fontSize: '0.9rem' }}>{t.label}</Typography>
                      <Typography variant="caption" sx={{ color: '#6B6B80' }}>{t.desc}</Typography>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Gender</InputLabel>
              <Select value={gender} label="Gender"
                onChange={(e) => setGender(e.target.value)}
                sx={{ borderRadius: 2 }}
              >
                <MenuItem value="male">Male</MenuItem>
                <MenuItem value="female">Female</MenuItem>
              </Select>
            </FormControl>

            <FormControlLabel
              control={<Checkbox checked={isTrainee} onChange={(e) => setIsTrainee(e.target.checked)} />}
              label={<Typography variant="body2">I am currently a trainee</Typography>}
            />
          </CardContent>
        </Card>

        {/* Class Schedule */}
        <Card sx={{ mb: 2, background: 'rgba(26, 26, 46, 0.7)', backdropFilter: 'blur(20px)', border: '1px solid rgba(139, 131, 255, 0.15)' }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5, color: '#E8E8F0' }}>
              Class Schedule
            </Typography>
            <Typography variant="body2" sx={{ color: '#6B6B80', mb: 2 }}>
              Times when you're unavailable for shifts
            </Typography>

            {/* Existing blocks grouped by day */}
            {blocks.length > 0 && (
              <Stack spacing={0.5} sx={{ mb: 2 }}>
                {blocks.map((b, idx) => (
                  <Stack key={idx} direction="row" alignItems="center" gap={1}
                    sx={{ bgcolor: 'rgba(255, 165, 2, 0.06)', borderRadius: 2, px: 1.5, py: 0.5, border: '1px solid rgba(255, 165, 2, 0.12)' }}
                  >
                    <Chip label={DAY_NAMES[b.day_of_week]} size="small" sx={{ fontSize: '0.7rem', height: 22 }} />
                    <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                      {fmtTime(b.start_time)} - {fmtTime(b.end_time)}
                    </Typography>
                    {b.label && <Typography variant="caption" sx={{ color: '#6B6B80' }}>({b.label})</Typography>}
                    <IconButton size="small" onClick={() => removeBlock(idx)} sx={{ ml: 'auto', color: '#FF6B6B' }}>
                      <Delete fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            )}

            {blocks.length === 0 && (
              <Typography variant="body2" sx={{ color: '#6B6B80', mb: 2, fontStyle: 'italic' }}>
                No class blocks added. You're available for all shifts.
              </Typography>
            )}

            {/* Add block form */}
            <Stack spacing={1.5} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(15, 15, 26, 0.4)', border: '1px solid rgba(139, 131, 255, 0.06)' }}>
              <FormControl fullWidth size="small">
                <InputLabel>Day</InputLabel>
                <Select value={newBlock.day_of_week} label="Day"
                  onChange={(e) => setNewBlock(prev => ({ ...prev, day_of_week: e.target.value }))}
                >
                  {DAY_NAMES.map((d, i) => <MenuItem key={i} value={i}>{d}</MenuItem>)}
                </Select>
              </FormControl>

              <Stack direction="row" gap={1}>
                <TextField
                  size="small" type="time" label="From" fullWidth
                  value={newBlock.start_time}
                  onChange={(e) => setNewBlock(prev => ({ ...prev, start_time: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  size="small" type="time" label="To" fullWidth
                  value={newBlock.end_time}
                  onChange={(e) => setNewBlock(prev => ({ ...prev, end_time: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
              </Stack>

              <TextField
                size="small" label="Label (optional)" placeholder="e.g., Chemistry 101" fullWidth
                value={newBlock.label}
                onChange={(e) => setNewBlock(prev => ({ ...prev, label: e.target.value }))}
              />

              <Button size="small" startIcon={<Add />} onClick={addBlock}
                sx={{ alignSelf: 'flex-start', color: '#2ED573' }}
              >
                Add Block
              </Button>
            </Stack>
          </CardContent>
        </Card>

        {/* Save */}
        <Button
          fullWidth variant="contained" size="large"
          onClick={handleSave} disabled={saving}
          startIcon={<Save />}
          sx={{
            py: 1.5, borderRadius: 2.5,
            fontSize: '1rem', fontWeight: 700,
            background: 'linear-gradient(135deg, #6C63FF 0%, #8B83FF 100%)',
            boxShadow: '0 4px 20px rgba(108, 99, 255, 0.3)',
            '&:hover': {
              background: 'linear-gradient(135deg, #5A52E0 0%, #7A72F0 100%)',
              boxShadow: '0 6px 25px rgba(108, 99, 255, 0.4)',
            },
          }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </Box>
    </Box>
  );
}

function Brand() {
  return (
    <Stack alignItems="center">
      <Box sx={{
        width: 48, height: 48,
        background: 'linear-gradient(135deg, #6C63FF 0%, #FF6B6B 100%)',
        borderRadius: 2.5,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: '1.3rem', color: '#fff',
        boxShadow: '0 8px 25px rgba(108, 99, 255, 0.35)',
        mb: 1,
      }}>
        W
      </Box>
      <Typography variant="h5" sx={{
        background: 'linear-gradient(135deg, #E8E8F0 0%, #9B9BB4 100%)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        fontSize: '1.4rem', fontWeight: 700,
      }}>
        Wollaston's
      </Typography>
      <Typography variant="caption" sx={{
        color: '#6C63FF', fontWeight: 600, letterSpacing: '0.15em',
        fontFamily: '"Inter", sans-serif', fontSize: '0.7rem',
      }}>
        SHIFT SCHEDULER
      </Typography>
    </Stack>
  );
}
