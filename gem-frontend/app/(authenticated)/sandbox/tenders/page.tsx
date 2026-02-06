import TendersExplorerSandbox from "@/app/(authenticated)/_components/tenders/TendersExplorer.sandbox";

export default function SandboxTenderExplorerPage() {
  return (
    <div className="p-6">
      <div className="mb-6 rounded-xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
        ⚠️ Sandbox Mode (Authenticated)
      </div>

      <TendersExplorerSandbox mode="all" />
    </div>
  );
}
