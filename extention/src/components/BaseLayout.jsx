function resolveAssetUrl(relativePath) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(relativePath);
  }
  return relativePath;
}

const NAV_ITEMS = [
  {
    id: 'home',
    href: '#home',
    icon: 'images/home_150dp_1F1F1F_FILL0_wght400_GRAD0_opsz48.png',
    title: 'Home Page',
  },
  {
    id: 'focustopic',
    href: '#focustopic',
    icon: 'images/smart_toy_150dp_1F1F1F_FILL0_wght400_GRAD0_opsz48.png',
    title: 'Focus Type Page',
  },
  {
    id: 'settings',
    href: '#settings',
    icon: 'images/settings_150dp_1F1F1F_FILL0_wght400_GRAD0_opsz48.png',
    title: 'Settings Page',
  },
  {
    id: 'contactus',
    href: '#contactus',
    icon: 'images/mail_150dp_1F1F1F_FILL0_wght400_GRAD0_opsz48.png',
    title: 'Contact Us Page',
  },
];

export default function BaseLayout({ activePage, onNavigate, settings, children }) {
  const classes = ['popup'];
  if (settings?.darkMode) classes.push('dark-mode');
  if (settings?.dyslexicFont) classes.push('dyslexic-font');
  classes.push(`font-${settings?.fontSize || 'medium'}`);

  const logoSrc = resolveAssetUrl('images/LokkedIn-removebg-preview 1.png');

  return (
    <div className={classes.join(' ')}>
      <div className="header">
        <img src={logoSrc} alt="LokkedIn" />
      </div>

      <main className="content">{children}</main>

      <div className="navbar">
        {NAV_ITEMS.map((item) => (
          <a
            key={item.id}
            href={item.href}
            title={item.title}
            data-title={item.title}
            className={activePage === item.id ? 'selected-nav-button' : ''}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(item.id);
            }}
          >
            <img src={resolveAssetUrl(item.icon)} alt={item.title} title={item.title} />
          </a>
        ))}
      </div>
    </div>
  );
}
