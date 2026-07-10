import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import NotificationToaster from '../notifications/NotificationToaster';
import AdsNotesFab from '../components/AdsNotesFab';
import BrandChatFab from '../components/BrandChatFab';

const KEY = 'ac_sidebar_collapsed';

export default function Layout() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);

  return (
    <div className={`ac-layout ${collapsed ? 'collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} />
      <div className="ac-main">
        <Topbar collapsed={collapsed} onToggleSidebar={() => setCollapsed(c => !c)} />
        <div className="ac-content">
          <Outlet />
        </div>
      </div>
      <NotificationToaster />
      {/* App-wide floating notes button (Ads Manager / Super Boss; self-guards). */}
      <AdsNotesFab />
      {/* Floating brand-chat button on Brand Detail pages (self-guards on
          role + brand-group membership). */}
      <BrandChatFab />
    </div>
  );
}
