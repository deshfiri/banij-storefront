"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ChevronRightIcon, CloseIcon, GridIcon, MailIcon, MenuIcon, PhoneIcon, UserIcon } from "@/components/icons";
import type { NavCategory } from "@/server/catalog";

/**
 * Mobile / tablet navigation drawer. A native <dialog> opened with showModal(): focus is trapped
 * inside, Esc closes it, the page behind is inert, and focus returns to the menu button on close.
 */
export function MobileMenu({
  lang,
  shopName,
  categories,
  languages,
  contact,
  ordersHref,
  labels,
}: {
  lang: string;
  shopName: string;
  categories: NavCategory[];
  languages: { locale: string; label: string }[];
  contact: { phone: string | null; email: string | null };
  /** "Your orders" — in the drawer because the header has no room for it on phones. */
  ordersHref: string | null;
  labels: { open: string; close: string; menu: string; all: string; categories: string; language: string; contact: string; empty: string; orders: string };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  // Close after navigating.
  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        className="icon-btn lg:hidden"
        aria-label={labels.open}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        <MenuIcon />
      </button>
      <dialog
        ref={dialog}
        className="drawer"
        aria-label={labels.menu}
        onClick={(event) => {
          // A click on the backdrop (the dialog element itself) closes the drawer.
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <p className="truncate font-semibold">{shopName}</p>
            <button type="button" className="icon-btn" aria-label={labels.close} onClick={() => dialog.current?.close()}>
              <CloseIcon />
            </button>
          </div>
          <nav aria-label={labels.categories} className="flex-1 overflow-y-auto px-2 py-3">
            <p className="px-3 pb-2 text-xs font-semibold tracking-wider text-muted uppercase">{labels.categories}</p>
            <ul>
              <li>
                <Link href={`/${lang}/products`} className="flex min-h-11 items-center gap-3 rounded-ctl px-3 font-medium hover:bg-surface-2">
                  <GridIcon size={18} />
                  <span className="flex-1">{labels.all}</span>
                  <ChevronRightIcon size={16} className="text-muted" />
                </Link>
              </li>
              {categories.map((category) => (
                <li key={category.slug}>
                  <Link href={`/${lang}${category.href}`} className="flex min-h-11 items-center gap-3 rounded-ctl px-3 hover:bg-surface-2">
                    <span className="flex-1">{category.name}</span>
                    <ChevronRightIcon size={16} className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
            {categories.length === 0 ? <p className="px-3 pt-2 text-sm text-muted">{labels.empty}</p> : null}

            {ordersHref ? (
              <Link href={ordersHref} className="mt-3 flex min-h-11 items-center gap-3 rounded-ctl border-t border-line px-3 pt-3 font-medium hover:bg-surface-2">
                <UserIcon size={18} />
                <span className="flex-1">{labels.orders}</span>
                <ChevronRightIcon size={16} className="text-muted" />
              </Link>
            ) : null}

            {languages.length > 0 ? (
              <>
                <p className="mt-5 px-3 pb-2 text-xs font-semibold tracking-wider text-muted uppercase">{labels.language}</p>
                <ul className="flex flex-wrap gap-2 px-3">
                  {languages.map((language) => (
                    <li key={language.locale}>
                      <Link
                        href={`/${language.locale}${pathname.replace(/^\/(en|bn)(?=\/|$)/, "")}`}
                        hrefLang={language.locale}
                        lang={language.locale}
                        aria-current={language.locale === lang ? "true" : undefined}
                        className={`btn btn-sm ${language.locale === lang ? "btn-primary" : "btn-ghost"}`}
                      >
                        {language.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </nav>
          {contact.phone || contact.email ? (
            <div className="space-y-2 border-t border-line px-5 py-4 text-sm">
              <p className="text-xs font-semibold tracking-wider text-muted uppercase">{labels.contact}</p>
              {contact.phone ? (
                <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`} className="flex items-center gap-2 hover:underline">
                  <PhoneIcon size={16} /> {contact.phone}
                </a>
              ) : null}
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="flex items-center gap-2 hover:underline">
                  <MailIcon size={16} /> {contact.email}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
