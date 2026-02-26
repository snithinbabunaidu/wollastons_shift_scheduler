import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import App from './App';
import { AuthProvider } from './context/AuthContext';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#6C63FF', light: '#8B83FF', dark: '#4A42D4' },
    secondary: { main: '#FF6B6B', light: '#FF8E8E', dark: '#D44545' },
    success: { main: '#2ED573', light: '#5AE08E', dark: '#1BAF5C' },
    warning: { main: '#FFA502', light: '#FFB733', dark: '#CC8400' },
    info: { main: '#45B7D1', light: '#6DC8DD', dark: '#2E95AE' },
    background: {
      default: '#0F0F1A',
      paper: '#1A1A2E',
    },
    text: {
      primary: '#E8E8F0',
      secondary: '#9B9BB4',
    },
    divider: 'rgba(139, 131, 255, 0.12)',
  },
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h4: { fontWeight: 800, letterSpacing: '-0.02em' },
    h5: { fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600, letterSpacing: '-0.005em' },
    subtitle1: { fontWeight: 500 },
    subtitle2: { fontWeight: 600, letterSpacing: '0.01em' },
    button: { fontWeight: 600, textTransform: 'none', letterSpacing: '0.01em' },
    body2: { fontSize: '0.875rem' },
    caption: { fontFamily: '"JetBrains Mono", monospace', fontSize: '0.72rem' },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(108, 99, 255, 0.06) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(255, 107, 107, 0.04) 0%, transparent 60%)',
          backgroundAttachment: 'fixed',
          scrollbarWidth: 'thin',
          scrollbarColor: '#6C63FF33 transparent',
          '&::-webkit-scrollbar': { width: 6 },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': { background: '#6C63FF33', borderRadius: 3 },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          padding: '8px 20px',
          fontSize: '0.85rem',
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
        },
        contained: {
          background: 'linear-gradient(135deg, #6C63FF 0%, #8B83FF 100%)',
          '&:hover': {
            background: 'linear-gradient(135deg, #5A52E0 0%, #7A72F0 100%)',
          },
        },
        outlined: {
          borderColor: 'rgba(108, 99, 255, 0.3)',
          '&:hover': {
            borderColor: 'rgba(108, 99, 255, 0.6)',
            background: 'rgba(108, 99, 255, 0.08)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(139, 131, 255, 0.08)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          background: 'rgba(26, 26, 46, 0.8)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(139, 131, 255, 0.1)',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          background: '#1A1A2E',
          border: '1px solid rgba(139, 131, 255, 0.15)',
          backdropFilter: 'blur(20px)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'rgba(15, 15, 26, 0.85)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(139, 131, 255, 0.1)',
          boxShadow: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          background: 'rgba(15, 15, 26, 0.95)',
          borderRight: '1px solid rgba(139, 131, 255, 0.1)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid rgba(139, 131, 255, 0.06)',
        },
        head: {
          fontWeight: 600,
          color: '#9B9BB4',
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          fontSize: '0.75rem',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          margin: '2px 8px',
          '&.Mui-selected': {
            background: 'rgba(108, 99, 255, 0.15)',
            '&:hover': { background: 'rgba(108, 99, 255, 0.2)' },
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(139, 131, 255, 0.15)',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(139, 131, 255, 0.3)',
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 10,
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          background: 'rgba(26, 26, 46, 0.95)',
          border: '1px solid rgba(139, 131, 255, 0.2)',
          borderRadius: 8,
          fontSize: '0.75rem',
        },
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
