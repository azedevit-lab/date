import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Invite from './pages/Invite.jsx';
import Admin from './pages/Admin.jsx';
import Home from './pages/Home.jsx';
import './styles.css';

console.log('%c🕵️‍♀️ Salam, pentester!', 'font-size:22px;font-weight:800;color:#ff4f9a;font-family:monospace');
console.log(
  '%cDevTools-u açacağını bilirdim 😏\nBurada zəiflik yoxdur... amma bir flag var:\n\nFLAG{y3s_1s_th3_0nly_v4l1d_p4yl04d}\n\nİndi geri qayıt və "Hə" düyməsinə bas',
  'font-size:13px;color:#39ff88;font-family:monospace;line-height:1.6',
);

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/i/:token" element={<Invite />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Home />} />
    </Routes>
  </BrowserRouter>,
);
