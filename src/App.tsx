import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { Navbar } from './components/common/Navbar';
import { MobileBottomNav } from './components/common/MobileBottomNav';
import { OfflineIndicator } from './components/common/OfflineIndicator';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { SplashScreen } from './components/common/SplashScreen';

// Pages
import { HomePage } from './pages/customer/HomePage';
import { RestaurantsExplorePage } from './pages/public/RestaurantsExplorePage';
import { RestaurantDetailPage } from './pages/customer/RestaurantDetailPage';
import { CartPage } from './pages/customer/CartPage';
import { OrdersPage } from './pages/customer/OrdersPage';
import { OrderDetailPage } from './pages/customer/OrderDetailPage';

import { CourierDashboard } from './pages/courier/CourierDashboard';
import { CourierEarningsPage } from './pages/courier/CourierEarningsPage';

import { RestaurantDashboard } from './pages/restaurant/RestaurantDashboard';
import { RestaurantMenuPage } from './pages/restaurant/RestaurantMenuPage';
import { RestaurantSettingsPage } from './pages/restaurant/RestaurantSettingsPage';

import { AdminDashboard } from './pages/admin/AdminDashboard';

import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ProfilePage } from './pages/auth/ProfilePage';

import { TermsPage, PrivacyPage } from './pages/public/TermsPage';
import { SupportPage } from './pages/public/SupportPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <div className="flex min-h-screen flex-col bg-canvas text-slate-900 selection:bg-brand selection:text-white">
            <Navbar />
            
            <div className="flex-1">
              <Routes>
                {/* Public & Customer Routes */}
                <Route path="/" element={<HomePage />} />
                <Route path="/restaurants" element={<RestaurantsExplorePage />} />
                <Route path="/restaurant/:id" element={<RestaurantDetailPage />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/checkout" element={<CartPage />} />

                {/* Authenticated Customer Routes */}
                <Route
                  path="/orders"
                  element={
                    <ProtectedRoute>
                      <OrdersPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/orders/:id"
                  element={
                    <ProtectedRoute>
                      <OrderDetailPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/profile"
                  element={
                    <ProtectedRoute>
                      <ProfilePage />
                    </ProtectedRoute>
                  }
                />

                {/* Courier Routes */}
                <Route
                  path="/courier/dashboard"
                  element={
                    <ProtectedRoute allowedRoles={['COURIER', 'SUPER_ADMIN']}>
                      <CourierDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/courier/deliveries"
                  element={
                    <ProtectedRoute allowedRoles={['COURIER', 'SUPER_ADMIN']}>
                      <CourierDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/courier/earnings"
                  element={
                    <ProtectedRoute allowedRoles={['COURIER', 'SUPER_ADMIN']}>
                      <CourierEarningsPage />
                    </ProtectedRoute>
                  }
                />

                {/* Restaurant Owner Routes */}
                <Route
                  path="/restaurant/dashboard"
                  element={
                    <ProtectedRoute allowedRoles={['RESTAURANT_OWNER', 'SUPER_ADMIN']}>
                      <RestaurantDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/restaurant/menu"
                  element={
                    <ProtectedRoute allowedRoles={['RESTAURANT_OWNER', 'SUPER_ADMIN']}>
                      <RestaurantMenuPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/restaurant/settings"
                  element={
                    <ProtectedRoute allowedRoles={['RESTAURANT_OWNER', 'SUPER_ADMIN']}>
                      <RestaurantSettingsPage />
                    </ProtectedRoute>
                  }
                />

                {/* Super Admin Web Dashboard (WEB ONLY) */}
                <Route
                  path="/admin/dashboard"
                  element={
                    <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                      <AdminDashboard />
                    </ProtectedRoute>
                  }
                />

                {/* Auth Routes */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />

                {/* Legal & Support */}
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/support" element={<SupportPage />} />

                {/* Catch-all */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>

            <MobileBottomNav />
            <OfflineIndicator />
            <SplashScreen />
          </div>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
