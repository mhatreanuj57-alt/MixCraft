import BrandMark from "./BrandMark";

type SiteSection = "overview" | "connections";

const NAV_ITEMS: { id: SiteSection; label: string; href: string }[] = [
  { id: "overview", label: "Overview", href: "/" },
  { id: "connections", label: "Connections", href: "/connections" },
];

export default function SiteHeader({ active }: { active: SiteSection }) {
  return (
    <header className="mc-header">
      <a className="mc-brand" href="/" aria-label="MixCraft overview">
        <BrandMark />
        <div className="mc-brand__copy">
          <p className="mc-eyebrow">Developer Control Center</p>
          <p className="mc-brand-name">MixCraft</p>
        </div>
      </a>
      <nav className="mc-nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <a
            key={item.id}
            className="mc-nav__link"
            href={item.href}
            aria-current={item.id === active ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
