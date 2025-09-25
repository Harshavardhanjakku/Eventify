import { useRouter } from 'next/router';
import { useOrganization } from '../contexts/OrganizationContext';

export default function Breadcrumb({ className = "" }) {
  const router = useRouter();
  const { currentOrganization, getCurrentUserRole } = useOrganization();

  // Generate breadcrumb items based on current route
  const getBreadcrumbItems = () => {
    const items = [];
    const path = router.asPath;
    const pathSegments = path.split('/').filter(Boolean);

    // Always start with home
    items.push({
      label: 'Home',
      href: '/media',
      isActive: path === '/media'
    });

    // Add organization context if available
    if (currentOrganization) {
      items.push({
        label: currentOrganization.name,
        href: `/switch/${currentOrganization.id}`,
        isActive: path.includes(`/switch/${currentOrganization.id}`),
        isOrganization: true
      });
    }

    // Add specific page context
    if (pathSegments.includes('events')) {
      const eventId = pathSegments[pathSegments.indexOf('events') + 1];
      if (eventId && eventId !== 'new') {
        items.push({
          label: 'Event Details',
          href: `/events/${eventId}`,
          isActive: true
        });
      } else if (eventId === 'new') {
        items.push({
          label: 'Create Event',
          href: '/events/new',
          isActive: true
        });
      } else {
        items.push({
          label: 'Events',
          href: '/events',
          isActive: true
        });
      }
    }

    if (pathSegments.includes('bookings')) {
      items.push({
        label: 'My Bookings',
        href: '/bookings',
        isActive: true
      });
    }

    if (pathSegments.includes('settings')) {
      items.push({
        label: 'Settings',
        href: '/settings',
        isActive: true
      });
    }

    return items;
  };

  const breadcrumbItems = getBreadcrumbItems();
  const userRole = getCurrentUserRole();

  if (breadcrumbItems.length <= 1) {
    return null; // Don't show breadcrumb if only home
  }

  return (
    <nav className={`flex items-center space-x-2 text-sm ${className}`} aria-label="Breadcrumb">
      <ol className="flex items-center space-x-2">
        {breadcrumbItems.map((item, index) => (
          <li key={item.href} className="flex items-center">
            {index > 0 && (
              <svg 
                className="w-4 h-4 text-white/40 mx-2" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
            
            {item.isActive ? (
              <span className="text-white font-medium flex items-center gap-2">
                {item.isOrganization && (
                  <div className="w-4 h-4 rounded bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                    {item.label[0].toUpperCase()}
                  </div>
                )}
                {item.label}
                {item.isOrganization && userRole && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-500/20 text-cyan-300">
                    {userRole === 'orgadmin' ? 'Admin' : 
                     userRole === 'organizer' ? 'Organizer' : 
                     userRole === 'user' ? 'Member' : userRole}
                  </span>
                )}
              </span>
            ) : (
              <a
                href={item.href}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(item.href);
                }}
                className="text-white/70 hover:text-white transition-colors flex items-center gap-2"
              >
                {item.isOrganization && (
                  <div className="w-4 h-4 rounded bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                    {item.label[0].toUpperCase()}
                  </div>
                )}
                {item.label}
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}