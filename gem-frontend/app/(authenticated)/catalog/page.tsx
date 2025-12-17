// ==============================
// Catalog Page (Optimized Option A)
// ==============================

'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import toast, { Toaster } from 'react-hot-toast';

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

      toast.success('Product added');

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

      toast.success(`Updated ${ids.length} item(s)`);
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

  // -------------------------------------
  // Render
  // -------------------------------------
  return (
    <div className="p-8 bg-white min-h-screen">
      <Toaster position="top-right" />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">My Product Catalogue</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 rounded-lg font-semibold bg-[#F7C846]"
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
      <div className="flex gap-3 items-center mb-4">
        <button
          className={`px-3 py-2 rounded-lg border ${actionMode === 'modify' ? 'ring-2 ring-yellow-400' : ''}`}
          onClick={() => setActionMode('modify')}
        >
          Modify (single)
        </button>

        <button
          className={`px-3 py-2 rounded-lg border ${actionMode === 'bulk-pause' ? 'ring-2 ring-yellow-400' : ''}`}
          onClick={() => setActionMode('bulk-pause')}
        >
          Pause Selected
        </button>

        <button
          className={`px-3 py-2 rounded-lg border ${actionMode === 'bulk-resume' ? 'ring-2 ring-yellow-400' : ''}`}
          onClick={() => setActionMode('bulk-resume')}
        >
          Resume Selected
        </button>

        <button
          className={`px-3 py-2 rounded-lg border ${actionMode === 'bulk-delete' ? 'ring-2 ring-red-400' : ''}`}
          onClick={() => setActionMode('bulk-delete')}
        >
          Delete Selected
        </button>

        <button
          className="px-3 py-2 rounded-lg border bg-gray-100"
          onClick={() => {
            setActionMode('none');
            setSelectedIds({});
            setSelectedRadioId(null);
          }}
        >
          Cancel Selection
        </button>

        {/* Right-Aligned Bulk Buttons */}
        <div className="ml-auto flex gap-2">
          {actionMode === 'bulk-pause' && (
            <button
              onClick={() => applyBulkStatus('paused')}
              disabled={!Object.values(selectedIds).some(Boolean)}
              className="px-3 py-2 rounded-lg bg-yellow-400"
            >
              Apply Pause
            </button>
          )}
          {actionMode === 'bulk-resume' && (
            <button
              onClick={() => applyBulkStatus('active')}
              disabled={!Object.values(selectedIds).some(Boolean)}
              className="px-3 py-2 rounded-lg bg-green-300"
            >
              Apply Resume
            </button>
          )}
          {actionMode === 'bulk-delete' && (
            <button
              onClick={() => {
                const ids = Object.keys(selectedIds).filter(id => selectedIds[id]);
                if (ids.length) {
                  setDeleteTargetIds(ids);
                  setShowDeleteConfirm(true);
                }
              }}
              disabled={!Object.values(selectedIds).some(Boolean)}
              className="px-3 py-2 rounded-lg bg-red-500 text-white"
            >
              Confirm Delete
            </button>
          )}
        </div>
      </div>

      {/* Table or loading */}
      {loading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-100 rounded" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <p className="mt-6 text-lg text-gray-700">No products found.</p>
      ) : (
        <>
          <table className="w-full border border-gray-300 bg-white">
            <thead>
              <tr className="bg-gray-100">
                <th className="p-3 border text-left">#</th>
                <th className="p-3 border text-left">Product Name</th>
                <th className="p-3 border text-left">Category</th>
                <th className="p-3 border text-left">Status</th>
                <th className="p-3 border text-left">Updated At</th>
              </tr>
            </thead>

            <tbody>
              {products.map((p, idx) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="p-3 border">
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
                      <span>{(currentPage - 1) * PAGE_SIZE + idx + 1}</span>
                    )}
                  </td>

                  <td className="p-3 border">{p.title}</td>
                  <td className="p-3 border">{p.category}</td>
                  <td className="p-3 border capitalize">{p.status}</td>
                  <td className="p-3 border">
                    {new Date(p.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="flex justify-between items-center mt-6">
            <button
              onClick={() => currentPage > 1 && setCurrentPage(p => p - 1)}
              disabled={currentPage === 1}
              className="px-4 py-2 bg-gray-200 rounded"
            >
              Previous
            </button>

            <span>Page {currentPage}</span>

            <button
              onClick={() => products.length === PAGE_SIZE && setCurrentPage(p => p + 1)}
              disabled={products.length < PAGE_SIZE}
              className="px-4 py-2 bg-gray-200 rounded"
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
            <Input value={newCategory} onChange={setNewCategory} placeholder="Product Category" required />

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
