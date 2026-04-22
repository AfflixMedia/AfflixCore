import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function Layout() {
  return (
    <div className="ac-layout">
      <Sidebar />
      <div className="ac-main">
        <Topbar />
        <div className="ac-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
