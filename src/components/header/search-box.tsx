"use client";

import { useSearchParams } from "next/navigation";
import { SearchIcon } from "@/components/icons";

/** Product search: a plain GET form (works without JavaScript); keeps the current query visible. */
export function SearchBox({ lang, placeholder, buttonLabel }: { lang: string; placeholder: string; buttonLabel: string }) {
  const query = useSearchParams().get("q") ?? "";
  return <SearchForm lang={lang} placeholder={placeholder} buttonLabel={buttonLabel} defaultValue={query} />;
}

export function SearchForm({
  lang,
  placeholder,
  buttonLabel,
  defaultValue = "",
}: {
  lang: string;
  placeholder: string;
  buttonLabel: string;
  defaultValue?: string;
}) {
  return (
    <form action={`/${lang}/products`} role="search" className="flex w-full min-w-0">
      <label className="sr-only" htmlFor="site-search">
        {placeholder}
      </label>
      <input
        id="site-search"
        name="q"
        type="search"
        maxLength={100}
        defaultValue={defaultValue}
        placeholder={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        className="field min-h-12 min-w-0 flex-1 rounded-r-none border-r-0 px-4"
      />
      <button type="submit" className="btn btn-accent min-h-12 shrink-0 rounded-l-none px-5" aria-label={buttonLabel}>
        <SearchIcon />
        <span className="sr-only">{buttonLabel}</span>
      </button>
    </form>
  );
}
