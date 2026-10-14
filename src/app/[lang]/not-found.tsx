"use client";

import { useParams } from "next/navigation";
import { SearchIcon } from "@/components/icons";
import { EmptyState } from "@/components/states";
import { dictionary, isLocale } from "@/lib/i18n";

export default function NotFound() {
  const params = useParams<{ lang?: string }>();
  const lang = params.lang && isLocale(params.lang) ? params.lang : "en";
  const t = dictionary(lang);
  return (
    <div className="py-6">
      <EmptyState
        headingLevel={1}
        icon={<SearchIcon size={26} />}
        title={t.states.notFound}
        text={t.states.notFoundText}
        action={{ href: `/${lang}/products`, label: t.cart.continue }}
      />
    </div>
  );
}
