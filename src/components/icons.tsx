import type { SVGProps } from "react";

/**
 * Inline stroke icons (24×24, currentColor). Decorative by default (aria-hidden); the control that
 * contains an icon carries the accessible name. No icon package, no brand artwork.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const CartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 7h13l-1.5 8.5a2 2 0 0 1-2 1.5H9.6a2 2 0 0 1-2-1.6L5.4 4.6A1.5 1.5 0 0 0 3.9 3.5H3" />
    <circle cx="10" cy="20.5" r="1" />
    <circle cx="17" cy="20.5" r="1" />
  </Icon>
);

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Icon>
);

export const PhoneIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  </Icon>
);

export const MailIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m4 7 8 6 8-6" />
  </Icon>
);

export const PinIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Icon>
);

export const GridIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Icon>
);

export const CashIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6.5 9.5v5M17.5 9.5v5" />
  </Icon>
);

/* Generic social glyphs (simplified, not brand artwork); always paired with a text label. */
export const SocialIcon = ({ network, ...p }: IconProps & { network: string }) => {
  switch (network) {
    case "facebook":
      return (
        <Icon {...p}>
          <path d="M14 8h2V4.5h-2.5A3.5 3.5 0 0 0 10 8v2.5H8V14h2v6h3.5v-6H16l.5-3.5h-3V8.5c0-.3.2-.5.5-.5Z" />
        </Icon>
      );
    case "instagram":
      return (
        <Icon {...p}>
          <rect x="4" y="4" width="16" height="16" rx="4.5" />
          <circle cx="12" cy="12" r="3.5" />
          <circle cx="16.8" cy="7.2" r="0.6" fill="currentColor" />
        </Icon>
      );
    case "youtube":
      return (
        <Icon {...p}>
          <rect x="3" y="6" width="18" height="12" rx="3.5" />
          <path d="m10.5 9.5 4 2.5-4 2.5Z" fill="currentColor" />
        </Icon>
      );
    case "tiktok":
      return (
        <Icon {...p}>
          <path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5M14 4c.5 2.4 2.2 4 4.5 4.3" />
        </Icon>
      );
    case "whatsapp":
      return (
        <Icon {...p}>
          <path d="M5 19.5 6 16a7.5 7.5 0 1 1 2.8 2.6Z" />
          <path d="M9.5 9.5c.3 2 2 3.8 4 4.4l1-1" />
        </Icon>
      );
    case "linkedin":
      return (
        <Icon {...p}>
          <rect x="4" y="4" width="16" height="16" rx="2.5" />
          <path d="M8 10.5V16M8 8v.01M11.5 16v-5.5M11.5 13a2.5 2.5 0 0 1 5 0V16" />
        </Icon>
      );
    case "x":
      return (
        <Icon {...p}>
          <path d="m5 5 14 14M19 5 5 19" />
        </Icon>
      );
    default:
      return <GlobeIcon {...p} />;
  }
};

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.75" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const TruckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6.5h11v9H3zM14 9.5h3.5l3 3v3H14" />
    <circle cx="7" cy="17.5" r="1.75" />
    <circle cx="17" cy="17.5" r="1.75" />
  </Icon>
);

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const ReturnIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 7 5 11l4 4" />
    <path d="M5 11h9.5a4.5 4.5 0 0 1 0 9H12" />
  </Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const ReceiptIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2Z" />
    <path d="M9 8h6M9 11.5h6M9 15h3.5" />
  </Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m15 6-6 6 6 6" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

/** Icon for a trust / benefit card, by the names content.json and the storefront use. */
export function BenefitIcon({ name, ...p }: IconProps & { name: string }) {
  switch (name) {
    case "cash":
      return <CashIcon {...p} />;
    case "truck":
      return <TruckIcon {...p} />;
    case "return":
      return <ReturnIcon {...p} />;
    case "shield":
      return <ShieldIcon {...p} />;
    case "phone":
      return <PhoneIcon {...p} />;
    case "clock":
      return <ClockIcon {...p} />;
    default:
      return <CheckIcon {...p} />;
  }
}
