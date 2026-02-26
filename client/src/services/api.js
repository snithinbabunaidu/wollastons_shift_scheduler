import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 globally
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// Auth
export const login = (username, password) =>
  api.post('/auth/login', { username, password });

// Employees
export const getEmployees = () => api.get('/employees');
export const getEmployee = (id) => api.get(`/employees/${id}`);
export const createEmployee = (data) => api.post('/employees', data);
export const updateEmployee = (id, data) => api.put(`/employees/${id}`, data);
export const deleteEmployee = (id) => api.delete(`/employees/${id}`);
export const getAvailability = (id) => api.get(`/employees/${id}/availability`);
export const updateAvailability = (id, availability) =>
  api.put(`/employees/${id}/availability`, { availability });
export const getLockedShifts = (id) => api.get(`/employees/${id}/locked-shifts`);
export const updateLockedShifts = (id, locked_shifts) =>
  api.put(`/employees/${id}/locked-shifts`, { locked_shifts });
export const getUnavailableTimes = (id) => api.get(`/employees/${id}/unavailable-times`);
export const updateUnavailableTimes = (id, blocks) =>
  api.put(`/employees/${id}/unavailable-times`, { blocks });
export const getWeeklyUnavailable = (id, weekStart) =>
  api.get(`/employees/${id}/unavailable-times/${weekStart}`);
export const updateWeeklyUnavailable = (id, weekStart, blocks) =>
  api.put(`/employees/${id}/unavailable-times/${weekStart}`, { blocks });
export const getAllWeeklyOverrides = (weekStart) =>
  api.get(`/employees/weekly-overrides/${weekStart}`);

// Shift Config
export const getShiftConfigs = () => api.get('/shift-config');
export const updateShiftConfigs = (configs) => api.put('/shift-config', { configs });
export const resetShiftConfigs = () => api.post('/shift-config/reset');

// Schedules
export const getSchedule = (weekStart) => api.get(`/schedules/${weekStart}`);
export const saveSchedule = (weekStart, assignments) =>
  api.put(`/schedules/${weekStart}`, { assignments });
export const updateScheduleSettings = (weekStart, settings) =>
  api.put(`/schedules/${weekStart}/settings`, { settings });
export const autoGenerateSchedule = (weekStart, { overflowHours = 0 } = {}) =>
  api.post(`/schedules/${weekStart}/auto-generate`, { overflow_hours: overflowHours });
export const getAvailableEmployees = (weekStart, dayOfWeek, shiftPeriod) =>
  api.get(`/schedules/${weekStart}/available/${dayOfWeek}/${shiftPeriod}`);
export const downloadPDF = (weekStart) =>
  api.get(`/schedules/${weekStart}/pdf`, { responseType: 'blob' });

// Order Days
export const getOrderDays = () => api.get('/order-days');
export const updateOrderDays = (ag, us) => api.put('/order-days', { ag, us });

// Availability Backup/Restore
export const exportAvailability = () => api.get('/employees/export-availability');
export const importAvailability = (data) => api.post('/employees/import-availability', data);

export default api;
