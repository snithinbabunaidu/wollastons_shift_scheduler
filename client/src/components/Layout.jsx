import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  AppBar, Toolbar, Typography, Box, Drawer, List, ListItemButton,
  ListItemIcon, ListItemText, IconButton, Divider, Avatar, Stack, Chip,
} from '@mui/material';
import {
  Menu as MenuIcon, CalendarMonth, People, Settings, Logout,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';

const DRAWER_WIDTH = 260;

const navItems = [
  { label: 'Schedule', path: '/', icon: <CalendarMonth />, desc: 'Weekly shifts' },
  { label: 'Employees', path: '/employees', icon: <People />, desc: 'Manage team' },
  { label: 'Settings', path: '/settings', icon: <Settings />, desc: 'Configuration' },
];

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2.5, pb: 2 }}>
        <Stack direction="row" alignItems="center" gap={1.5}>
          <Box sx={{
            width: 40, height: 40,
            background: 'linear-gradient(135deg, #6C63FF 0%, #FF6B6B 100%)',
            borderRadius: 2.5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: '1.1rem', color: '#fff',
            boxShadow: '0 4px 15px rgba(108, 99, 255, 0.3)',
          }}>
            W
          </Box>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2, color: '#E8E8F0' }}>
              Wollaston's
            </Typography>
            <Typography variant="caption" sx={{ color: '#6C63FF', fontWeight: 500, fontFamily: '"Inter", sans-serif', fontSize: '0.68rem', letterSpacing: '0.05em' }}>
              SHIFT SCHEDULER
            </Typography>
          </Box>
        </Stack>
      </Box>
      <Divider sx={{ mx: 2, borderColor: 'rgba(139, 131, 255, 0.08)' }} />

      <List sx={{ px: 1, py: 1.5, flex: 1 }}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <ListItemButton
              key={item.path}
              selected={isActive}
              onClick={() => { navigate(item.path); setMobileOpen(false); }}
              sx={{
                mb: 0.5,
                py: 1.2,
                transition: 'all 0.2s ease',
                ...(isActive && {
                  background: 'linear-gradient(135deg, rgba(108, 99, 255, 0.15) 0%, rgba(108, 99, 255, 0.08) 100%)',
                  borderLeft: '3px solid #6C63FF',
                  '& .MuiListItemIcon-root': { color: '#6C63FF' },
                  '& .MuiListItemText-primary': { color: '#E8E8F0', fontWeight: 600 },
                }),
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: isActive ? '#6C63FF' : '#9B9BB4' }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                secondary={item.desc}
                primaryTypographyProps={{ fontSize: '0.9rem', fontWeight: isActive ? 600 : 400 }}
                secondaryTypographyProps={{ fontSize: '0.68rem', color: '#6B6B80' }}
              />
            </ListItemButton>
          );
        })}
      </List>

      <Divider sx={{ mx: 2, borderColor: 'rgba(139, 131, 255, 0.08)' }} />
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" gap={1.5} mb={1.5}>
          <Avatar sx={{
            width: 32, height: 32,
            background: 'linear-gradient(135deg, #6C63FF 0%, #45B7D1 100%)',
            fontSize: '0.8rem', fontWeight: 700,
          }}>
            {user?.username?.charAt(0).toUpperCase()}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }} noWrap>
              {user?.username}
            </Typography>
            <Typography variant="caption" sx={{ color: '#6B6B80', fontFamily: '"Inter", sans-serif', fontSize: '0.65rem' }}>
              Admin
            </Typography>
          </Box>
        </Stack>
        <ListItemButton
          onClick={logout}
          sx={{
            borderRadius: 2,
            py: 0.8,
            color: '#FF6B6B',
            '&:hover': { background: 'rgba(255, 107, 107, 0.08)' },
          }}
        >
          <ListItemIcon sx={{ minWidth: 32, color: '#FF6B6B' }}><Logout fontSize="small" /></ListItemIcon>
          <ListItemText primary="Sign Out" primaryTypographyProps={{ fontSize: '0.85rem', fontWeight: 500 }} />
        </ListItemButton>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ minHeight: '56px !important' }}>
          <IconButton color="inherit" edge="start" onClick={() => setMobileOpen(!mobileOpen)} sx={{ mr: 2, display: { md: 'none' } }}>
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ flexGrow: 1, fontWeight: 700, fontSize: '1.05rem' }}>
            <Box component="span" sx={{ background: 'linear-gradient(135deg, #6C63FF 0%, #45B7D1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Wollaston's
            </Box>
            <Box component="span" sx={{ color: '#9B9BB4', fontWeight: 400, ml: 1 }}>Shift Scheduler</Box>
          </Typography>
          <Chip
            size="small"
            label="v2.0"
            sx={{
              background: 'rgba(108, 99, 255, 0.15)',
              color: '#8B83FF',
              fontWeight: 600,
              fontSize: '0.65rem',
              height: 22,
              border: '1px solid rgba(108, 99, 255, 0.2)',
            }}
          />
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH, flexShrink: 0,
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar sx={{ minHeight: '56px !important' }} />
        {drawer}
      </Drawer>

      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
      >
        {drawer}
      </Drawer>

      <Box component="main" sx={{
        flexGrow: 1, p: { xs: 2, md: 3 }, mt: 7, minHeight: '100vh',
        maxWidth: { md: `calc(100vw - ${DRAWER_WIDTH}px)` },
      }}>
        <Outlet />
      </Box>
    </Box>
  );
}
