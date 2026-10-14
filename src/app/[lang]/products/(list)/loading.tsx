import { ProductGridSkeleton } from "@/components/product-card";

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      <div className="skeleton h-4 w-40" />
      <div className="skeleton h-9 w-56" />
      <div className="grid gap-6 lg:grid-cols-[16.5rem_1fr]">
        <div className="skeleton h-12 lg:h-80" />
        <ProductGridSkeleton count={8} narrow />
      </div>
    </div>
  );
}
