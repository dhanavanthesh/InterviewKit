"use client";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { KitBuilder } from "../../../components/builder/kit-builder";
export default function KitPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Suspense>
      <KitBuilder id={id} />
    </Suspense>
  );
}
