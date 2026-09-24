import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty-state">
      <h1>Page not found</h1>
      <p>The page may have moved or the address may be incorrect.</p>
      <Link className="button button-primary" href="/kits">
        Back to kits
      </Link>
    </div>
  );
}
