// frontend/web-app/src/components/NavBar.js
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const NavBar = () => {
  const { user, signOut } = useAuthStore();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const link = ({ isActive }) => (isActive ? 'active' : undefined);

  return (
    <nav className="nav">
      <div className="nav-brand">ride<span>share</span></div>
      <NavLink to="/dashboard" className={link}>Dashboard</NavLink>
      <NavLink to="/book-ride" className={link}>Book a ride</NavLink>
      <NavLink to="/driver-mode" className={link}>Driver mode</NavLink>
      <NavLink to="/profile" className={link}>Profile</NavLink>
      <div className="nav-spacer" />
      <span className="nav-user">{user?.attributes?.email}</span>
      <button className="ghost" onClick={handleSignOut}>Sign out</button>
    </nav>
  );
};

export default NavBar;
