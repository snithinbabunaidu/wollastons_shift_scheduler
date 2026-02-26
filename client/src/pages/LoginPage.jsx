import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert, Stack,
} from '@mui/material';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();

  if (user) return <Navigate to="/" />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      sx={{
        background: '#0F0F1A',
        backgroundImage: 'radial-gradient(ellipse at 50% 0%, rgba(108, 99, 255, 0.15) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(255, 107, 107, 0.08) 0%, transparent 50%)',
      }}
    >
      <Card sx={{
        maxWidth: 420, width: '100%', mx: 2,
        background: 'rgba(26, 26, 46, 0.7)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(139, 131, 255, 0.15)',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px rgba(108, 99, 255, 0.08)',
      }}>
        <CardContent sx={{ p: 5 }}>
          {/* Brand */}
          <Stack alignItems="center" mb={4}>
            <Box sx={{
              width: 56, height: 56,
              background: 'linear-gradient(135deg, #6C63FF 0%, #FF6B6B 100%)',
              borderRadius: 3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: '1.5rem', color: '#fff',
              mb: 2,
              boxShadow: '0 8px 25px rgba(108, 99, 255, 0.35)',
            }}>
              W
            </Box>
            <Typography variant="h4" align="center" sx={{
              background: 'linear-gradient(135deg, #E8E8F0 0%, #9B9BB4 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              fontSize: '1.8rem',
            }}>
              Wollaston's
            </Typography>
            <Typography variant="caption" sx={{
              color: '#6C63FF', fontWeight: 600, letterSpacing: '0.15em',
              fontFamily: '"Inter", sans-serif', fontSize: '0.75rem', mt: 0.5,
            }}>
              SHIFT SCHEDULER
            </Typography>
          </Stack>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth label="Username" margin="normal"
              value={username} onChange={(e) => setUsername(e.target.value)}
              autoFocus required
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
            />
            <TextField
              fullWidth label="Password" type="password" margin="normal"
              value={password} onChange={(e) => setPassword(e.target.value)}
              required
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
            />
            <Button
              fullWidth variant="contained" type="submit" size="large"
              sx={{
                mt: 3, py: 1.5, borderRadius: 2.5,
                fontSize: '0.95rem', fontWeight: 700,
                background: 'linear-gradient(135deg, #6C63FF 0%, #8B83FF 100%)',
                boxShadow: '0 4px 20px rgba(108, 99, 255, 0.3)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #5A52E0 0%, #7A72F0 100%)',
                  boxShadow: '0 6px 25px rgba(108, 99, 255, 0.4)',
                },
              }}
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
