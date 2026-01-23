export default function Footer() {
  return (
    <footer className="border-t bg-white">
      <div className="mx-auto max-w-7xl px-6 py-10 text-sm text-gray-500">
        © {new Date().getFullYear()} TenderBot. All rights reserved.
      </div>
    </footer>
  );
}
