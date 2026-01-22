import Sidebar from '@/components/Sidebar';

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-[#F5F5F7]">
      <Sidebar />
      <div className="flex flex-col flex-1">
        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
