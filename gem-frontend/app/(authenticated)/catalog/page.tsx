// ==============================
// Catalog Page (Optimized Option A)
// ==============================

'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import toast, { Toaster } from 'react-hot-toast';
import { Search, Zap, Target, Info } from 'lucide-react';

// ---------------------
// Types
// ---------------------
interface CatalogItem {
  id: string;
  title: string;
  category: string;
  status: string;
  updated_at: string;
  user_id: string;
}

type ActionMode = 'none' | 'modify' | 'bulk-pause' | 'bulk-resume' | 'bulk-delete';
const TOOLBAR_BTN_WIDTH = 'w-[140px]';


// ---------------------
// Component
// ---------------------
export default function CatalogPage() {
  // Stable client instance
  const [supabaseClient, setSupabaseClient] = useState<any | null>(null);

  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  // Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Field state for add/edit
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [adding, setAdding] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editing, setEditing] = useState(false);

  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([]);
  const [processingBulk, setProcessingBulk] = useState(false);

  // Selection state
  const [actionMode, setActionMode] = useState<ActionMode>('none');
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [selectedRadioId, setSelectedRadioId] = useState<string | null>(null);

  // Page Loading
  const [loading, setLoading] = useState(false);

  const mountedRef = useRef(false);

  // -------------------------------------
  // Initialize component + Supabase client
  // -------------------------------------
  useEffect(() => {
    mountedRef.current = true;
    try {
      const client = createClient();
      if (mountedRef.current) setSupabaseClient(client);
    } catch (e) {
      console.error('Supabase init error:', e);
    }
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // -------------------------------------
  // Helper: Get authenticated user safely
  // -------------------------------------
  async function getCurrentUser() {
    if (!supabaseClient) return null;

    const { data, error } = await supabaseClient.auth.getUser();
    if (error || !data?.user) return null;
    return data.user;
  }

  // -------------------------------------
  // Fetch products from Supabase
  // -------------------------------------
  async function fetchProducts(page = currentPage) {
    if (!supabaseClient) return;

    setLoading(true);

    try {
      const user = await getCurrentUser();
      if (!user) {
        if (mountedRef.current) setProducts([]);
        return;
      }

      // Base query
      let query = supabaseClient
        .from('catalog_items')
        .select('id, title, category, status, updated_at, user_id')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      // Search filter
      if (searchTerm.trim()) {
        const term = `%${searchTerm}%`;
        query = query.or(`title.ilike.${term},category.ilike.${term}`);
      }

      // Pagination
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await query.range(from, to);

      if (error) {
        console.error('fetchProducts error:', error);
        toast.error('Failed to load products');
        if (mountedRef.current) setProducts([]);
        return;
      }

      if (mountedRef.current) setProducts(data || []);
    } catch (err) {
      console.error('fetchProducts exception:', err);
      if (mountedRef.current) {
        setProducts([]);
        toast.error('Failed to load products');
      }
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);

      // Reset selection state whenever the table reloads
      setSelectedIds({});
      setSelectedRadioId(null);
      setActionMode('none');
    }
  }

  // Load products on changes
  useEffect(() => {
    if (supabaseClient) fetchProducts();
  }, [currentPage, searchTerm, supabaseClient]);

  // -------------------------------------
  // Match Jobs Helper
  // -------------------------------------
  async function enqueueMatch(action: string, ids: string[]) {
    if (!ids.length) return;

    const user = await getCurrentUser();
    if (!user) {
      toast.error("Not authenticated");
      return;
    }

    const session = await supabaseClient.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) return;

    try {
      await fetch('/api/match-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action, catalog_item_ids: ids }),
      });
    } catch (e) {
      console.error("enqueueMatch error:", e);
    }
  }

  // -------------------------------------
  // Add Product
  // -------------------------------------
  async function handleAddProduct(e: any) {
    e.preventDefault();
    if (!newTitle.trim() || !newCategory.trim()) return;

    setAdding(true);

    try {
      const user = await getCurrentUser();
      if (!user) {
        toast.error('Not authenticated');
        return;
      }

      const { data, error } = await supabaseClient
        .from('catalog_items')
        .insert({
          title: newTitle.trim(),
          category: newCategory.trim(),
          status: 'active',
          user_id: user.id,
          updated_at: new Date().toISOString(),
        })
        .select();

      if (error) {
        console.error('Insert error:', error);
        toast.error('Failed to add product');
        return;
      }

      toast.success('Product added! TenderMatch will start scanning tenders within a few minutes.');

      const newItem = data?.[0];
      if (newItem?.id) enqueueMatch('create', [newItem.id]);

      setCurrentPage(1);
      fetchProducts(1);
    } finally {
      setAdding(false);
      setShowAddModal(false);
      setNewTitle('');
      setNewCategory('');
    }
  }

  // -------------------------------------
  // Edit Product
  // -------------------------------------
  async function handleSaveEdit(e: any) {
    e.preventDefault();
    if (!editId) return;

    setEditing(true);

    try {
      const user = await getCurrentUser();
      if (!user) {
        toast.error('Not authenticated');
        return;
      }

      const { error } = await supabaseClient
        .from('catalog_items')
        .update({
          title: editTitle.trim(),
          category: editCategory.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', editId)
        .eq('user_id', user.id);

      if (error) {
        console.error('Edit error:', error);
        toast.error('Failed to update product');
        return;
      }

      toast.success('Product updated');
      enqueueMatch('update', [editId]);
      fetchProducts(currentPage);
    } finally {
      setEditing(false);
      setShowEditModal(false);
      setEditId(null);
      setEditTitle('');
      setEditCategory('');
      setActionMode('none');
    }
  }

  // -------------------------------------
  // Bulk Pause/Resume
  // -------------------------------------
  async function applyBulkStatus(newStatus: 'paused' | 'active') {
    const ids = Object.keys(selectedIds).filter(id => selectedIds[id]);
    if (!ids.length) {
      toast('No items selected');
      return;
    }

    setProcessingBulk(true);

    try {
      const user = await getCurrentUser();
      if (!user) {
        toast.error('Not authenticated');
        return;
      }

      const { error } = await supabaseClient
        .from('catalog_items')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .in('id', ids)
        .eq('user_id', user.id);

      if (error) {
        console.error("bulk update error", error);
        toast.error('Failed to update items');
        return;
      }

      toast.success(
        newStatus === 'paused'
          ? 'Products paused. You will no longer receive tender matches for these items.'
          : 'Products resumed. Tender matching is active again for these items.'
      );

      enqueueMatch(newStatus === 'paused' ? 'pause' : 'resume', ids);

      fetchProducts(currentPage);
    } finally {
      setProcessingBulk(false);
      setActionMode('none');
      setSelectedIds({});
    }
  }

  // -------------------------------------
  // Delete Items
  // -------------------------------------
  async function performDeleteConfirmed() {
    const ids = deleteTargetIds;
    if (!ids.length) return;

    setProcessingBulk(true);

    try {
      const user = await getCurrentUser();
      if (!user) {
        toast.error('Not authenticated');
        return;
      }

      await enqueueMatch('delete', ids);

      const { error } = await supabaseClient
        .from('catalog_items')
        .delete()
        .in('id', ids)
        .eq('user_id', user.id);

      if (error) {
        toast.error("Failed to delete items");
        return;
      }

      toast.success(`Deleted ${ids.length} item(s)`);
      fetchProducts(currentPage);
    } finally {
      setProcessingBulk(false);
      setShowDeleteConfirm(false);
      setDeleteTargetIds([]);
      setSelectedIds({});
      setActionMode('none');
    }
  }

  function getToolbarHint(actionMode: ActionMode) {
    switch (actionMode) {
      case 'modify':
        return 'Select a product using the radio button to edit its details.';
      case 'bulk-pause':
        return 'Select one or more products to pause recommendations for them.';
      case 'bulk-resume':
        return 'Select one or more paused products to resume recommendations.';
      case 'bulk-delete':
        return 'Select products you want to permanently remove from your catalogue.';
      default:
        return 'Use the tools above to manage which products are used for tender recommendations.';
    }
  }

  // -------------------------------------
  // Render
  // -------------------------------------
  return (
    <div className="p-8 bg-white min-h-screen">
      <Toaster position="top-right" />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">My Product Catalogue</h1>
          <p className="text-sm text-gray-500 mt-1">
            {products.length} products actively monitored
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-5 py-2.5 rounded-lg font-semibold bg-yellow-400 hover:bg-yellow-500 shadow-sm transition"
        >
          + Add Product
        </button>
      </div>

      {/* Search */}
      <form onSubmit={(e) => { e.preventDefault(); setCurrentPage(1); }}>
        <input
          type="search"
          placeholder="Search by Name or Category"
          className="border border-gray-400 rounded-lg p-3 w-full max-w-xs mb-6"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </form>

      {/* Toolbar */}
      <div className={`flex items-center gap-3 mb-4 ${products.length === 0 ? 'opacity-40 pointer-events-none' : ''}`}>
        <button
          onClick={() => {
            if (actionMode === 'modify') {
              setActionMode('none');
              setSelectedRadioId(null);
              return;
            }
            setActionMode('modify');
          }}
          className={`${TOOLBAR_BTN_WIDTH} px-3 py-1.5 rounded-lg text-sm font-medium text-center
            ${actionMode === 'modify'
              ? 'bg-blue-100 text-blue-800'
              : 'border border-gray-300 hover:bg-gray-50'}
          `}
        >
          {actionMode === 'modify' ? 'Cancel Modify' : 'Modify'}
        </button>


        <button
          onClick={() => {
            const hasSelection = Object.values(selectedIds).some(Boolean);

            if (actionMode !== 'bulk-pause') {
              setActionMode('bulk-pause');
              return;
            }

            if (!hasSelection) {
              setActionMode('none');
              setSelectedIds({});
              return;
            }

            applyBulkStatus('paused');
          }}
          className={`${TOOLBAR_BTN_WIDTH} px-3 py-1.5 rounded-lg text-sm font-medium text-center
            ${actionMode !== 'bulk-pause'
              ? 'border border-gray-300 hover:bg-gray-50'
              : !Object.values(selectedIds).some(Boolean)
                ? 'bg-amber-100 text-amber-800'
                : 'bg-amber-400 text-white hover:bg-amber-500'
            }`}
        >
          {actionMode === 'bulk-pause' ? 'Apply Pause' : 'Pause'}
        </button>


        <button
          onClick={() => {
            const hasSelection = Object.values(selectedIds).some(Boolean);

            if (actionMode !== 'bulk-resume') {
              setActionMode('bulk-resume');
              return;
            }

            if (!hasSelection) {
              setActionMode('none');
              setSelectedIds({});
              return;
            }

            applyBulkStatus('active');
          }}
          className={`${TOOLBAR_BTN_WIDTH} px-3 py-1.5 rounded-lg text-sm font-medium text-center
            ${actionMode !== 'bulk-resume'
              ? 'border border-gray-300 hover:bg-gray-50'
              : !Object.values(selectedIds).some(Boolean)
                ? 'bg-green-100 text-green-800'
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
        >
          {actionMode === 'bulk-resume' ? 'Apply Resume' : 'Resume'}
        </button>


        <button
          onClick={() => {
            const ids = Object.keys(selectedIds).filter(id => selectedIds[id]);

            if (actionMode !== 'bulk-delete') {
              setActionMode('bulk-delete');
              return;
            }

            if (!ids.length) {
              setActionMode('none');
              setSelectedIds({});
              return;
            }

            setDeleteTargetIds(ids);
            setShowDeleteConfirm(true);
          }}
          className={`${TOOLBAR_BTN_WIDTH} px-3 py-1.5 rounded-lg text-sm font-medium text-center
            ${actionMode !== 'bulk-delete'
              ? 'border border-gray-300 hover:bg-gray-50'
              : !Object.values(selectedIds).some(Boolean)
                ? 'bg-red-100 text-red-800'
                : 'bg-red-500 text-white hover:bg-red-600'
            }`}
        >
          {actionMode === 'bulk-delete' ? 'Confirm Delete' : 'Delete'}
        </button>
      </div> 
      <div className="mt-3 mb-6 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-2 text-sm text-blue-700">
        <Info className="w-4 h-4 text-blue-500" />
        <span className="font-medium">{getToolbarHint(actionMode)}</span>
      </div>
      
      {/* Table or loading */}
      {loading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-100 rounded" />
          ))}
        </div>
      ) : products.length === 0 ? (
          <div className="mt-8 bg-white rounded-2xl p-12 shadow-lg ring-1 ring-gray-200 max-w-2xl mx-auto text-center">

            <h2 className="text-2xl font-semibold tracking-tight text-gray-800">
              Your product catalogue is empty
            </h2>

            <p className="mt-3 text-gray-600">
              Add your products to start receiving relevant tender matches automatically.
              This is the foundation of how TenderMatch works.
            </p>

            <div className="mt-10 grid grid-cols-3 gap-10 max-w-xl mx-auto text-gray-700">
              <div className="flex flex-col items-center text-center">
                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-200/80 mb-2 ring-1 ring-gray-300">
                  <Search className="w-5 h-5 text-gray-500" />
                </div>

                <span className="text-sm font-medium leading-tight">Better tender matches</span>
              </div>

              <div className="flex flex-col items-center text-center">
                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-200/80 mb-2 ring-1 ring-gray-300">
                  <Zap className="w-5 h-5 text-gray-500" />
                </div>
                <span className="text-sm font-medium leading-tight">Faster discovery</span>
              </div>

              <div className="flex flex-col items-center text-center">
                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-200/80 mb-2 ring-1 ring-gray-300">
                  <Target className="w-5 h-5 text-gray-500" />
                </div>
                <span className="text-sm font-medium leading-tight">Higher relevance</span>
              </div>
            </div>


            <button
              onClick={() => setShowAddModal(true)}
              className="mt-8 px-7 py-3.5 bg-yellow-400 rounded-xl font-semibold text-lg shadow-md hover:shadow-lg hover:bg-yellow-500 transition active:scale-95"
            >
              + Add Your First Product
            </button>

            <p className="mt-3 text-xs text-gray-500">
              Tip: Add product categories exactly as they appear in tenders for best results.
            </p>
          </div>


      ) : (
        <>
          <table className="w-full border border-gray-50 rounded-xl overflow-hidden bg-white shadow-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-sm uppercase tracking-wide">
                <th className="p-3 border border-gray-300 text-center w-[60px]">
                  {actionMode.includes('bulk') && (
                    <input
                      type="checkbox"
                      checked={products.every(p => selectedIds[p.id])}
                      onChange={() => {
                        const allSelected = products.every(p => selectedIds[p.id]);
                        const next: any = {};
                        products.forEach(p => (next[p.id] = !allSelected));
                        setSelectedIds(next);
                      }}
                    />
                  )}
                </th>
                <th className="p-3 border border-gray-300 text-center">Product Name</th>
                <th className="p-3 border border-gray-300 text-center">Category</th>
                <th className="p-3 border border-gray-300 text-center w-[305px]">
                  <div className="flex flex-col items-center leading-tight">
                    <span>Status</span>
                    <span className="text-xs text-gray-400 font-normal">
                      (Active = Recommendations Enabled)
                    </span>
                  </div>
                </th>
                <th className="p-3 border border-gray-300 text-center">Updated At</th>
              </tr>
            </thead>

            <tbody>
              {products.map((p, idx) => (
                <tr key={p.id} className="hover:bg-gray-50 transition">
                  <td className="p-3 border border-gray-300 w-[60px]">
                    <div className="flex items-center justify-center h-full">
                      {actionMode === 'modify' ? (
                        <input
                          type="radio"
                          checked={selectedRadioId === p.id}
                          onChange={() => {
                            setSelectedRadioId(p.id);
                            setEditId(p.id);
                            setEditTitle(p.title);
                            setEditCategory(p.category);
                            setShowEditModal(true);
                          }}
                        />
                      ) : actionMode.includes('bulk') ? (
                        <input
                          type="checkbox"
                          checked={!!selectedIds[p.id]}
                          onChange={() =>
                            setSelectedIds(prev => ({ ...prev, [p.id]: !prev[p.id] }))
                          }
                        />
                      ) : (
                        <span className="text-sm font-medium">
                          {(currentPage - 1) * PAGE_SIZE + idx + 1}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 border border-gray-300 text-center">{p.title}</td>
                  <td className="p-3 border border-gray-300 text-center">{p.category}</td>
                  <td className="p-3 border border-gray-300 text-center w-[180px]">
                    <span className={`inline-flex justify-center min-w-[70px] px-3 py-1 rounded-full text-xs font-medium
                      ${p.status === 'active'
                        ? 'bg-green-50 text-green-600'
                        : 'bg-gray-200 text-gray-700'}
                    `}>
                      {p.status}
                    </span>
                  </td>

                  <td className="p-3 border border-gray-300 text-center">
                    {new Date(p.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="flex justify-center items-center gap-6 mt-10 text-sm text-gray-600">
            <button
              onClick={() => currentPage > 1 && setCurrentPage(p => p - 1)}
              disabled={currentPage === 1}
              className="px-4 py-2 bg-gray-100 rounded-full hover:bg-gray-200 disabled:opacity-40"
            >
              Previous
            </button>

            <span>Page {currentPage}</span>

            <button
              onClick={() => products.length === PAGE_SIZE && setCurrentPage(p => p + 1)}
              disabled={products.length < PAGE_SIZE}
              className="px-4 py-2 bg-gray-100 rounded-full hover:bg-gray-200 disabled:opacity-40"
            >
              Next
            </button>
          </div>

        </>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <Modal title="Add Product" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleAddProduct}>
              <Input value={newTitle} onChange={setNewTitle} placeholder="Product Name" required />
              <p className="text-xs text-gray-500 mb-3">
                Mention the name of your product
              </p>

              <Input value={newCategory} onChange={setNewCategory} placeholder="Product Category" required />
              <p className="text-xs text-gray-500 mb-3">
                Example: “Hospital Bed”, “Blood Gas Analyzer”, “Electrical Cable 4sqmm”
              </p>


            <ModalActions
              loading={adding}
              onCancel={() => setShowAddModal(false)}
              submitLabel="Add"
            />
          </form>
        </Modal>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <Modal title="Edit Product" onClose={() => setShowEditModal(false)}>
          <form onSubmit={handleSaveEdit}>
            <Input value={editTitle} onChange={setEditTitle} placeholder="Product Name" required />
            <Input value={editCategory} onChange={setEditCategory} placeholder="Product Category" required />

            <ModalActions
              loading={editing}
              onCancel={() => setShowEditModal(false)}
              submitLabel="Save"
            />
          </form>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <Modal title="Confirm Delete" onClose={() => setShowDeleteConfirm(false)}>
          <p className="mb-4">Are you sure you want to delete {deleteTargetIds.length} item(s)?</p>

          <div className="flex justify-end gap-2">
            <button
              className="px-4 py-2 bg-gray-200 rounded"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={processingBulk}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 bg-red-500 text-white rounded"
              onClick={performDeleteConfirmed}
              disabled={processingBulk}
            >
              {processingBulk ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --------------------------------------------
// Reusable small UI pieces (no logic changes)
// --------------------------------------------
function Modal({ title, children, onClose }: any) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-lg shadow min-w-[350px]">
        <h2 className="text-xl font-semibold mb-4">{title}</h2>
        {children}
        <button className="absolute top-4 right-4" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}

function Input({ value, onChange, ...props }: any) {
  return (
    <input
      className="w-full border border-gray-300 rounded-lg p-3 mb-4"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...props}
    />
  );
}

function ModalActions({ loading, onCancel, submitLabel }: any) {
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        className="px-5 py-2 rounded-lg bg-gray-200"
        onClick={onCancel}
        disabled={loading}
      >
        Cancel
      </button>
      <button
        type="submit"
        className="px-5 py-2 rounded-lg bg-yellow-400"
        disabled={loading}
      >
        {loading ? 'Please wait…' : submitLabel}
      </button>
    </div>
  );
}
