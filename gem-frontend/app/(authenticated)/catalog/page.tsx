'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import toast, { Toaster } from 'react-hot-toast';

interface CatalogItem {
  id: string;
  title: string;
  category: string;
  status: string;
  updated_at: string;
  user_id: string;
}

type ActionMode = 'none' | 'modify' | 'bulk-pause' | 'bulk-resume' | 'bulk-delete';

export default function CatalogPage() {
  const supabase = createClient();

  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);

  // Add Product modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [adding, setAdding] = useState(false);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editing, setEditing] = useState(false);

  // Delete confirmation modal
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([]);
  const [processingBulk, setProcessingBulk] = useState(false);

  // Selection & action mode
  const [actionMode, setActionMode] = useState<ActionMode>('none');
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({}); // id -> true if selected
  const [selectedRadioId, setSelectedRadioId] = useState<string | null>(null);

  const PAGE_SIZE = 10;

  // --- Helper: enqueue match jobs for one or more catalog items ---
    // --- Helper: enqueue match jobs for one or more catalog items ---
    // --- Helper: enqueue match jobs for one or more catalog items ---
  async function enqueueMatchJobs(
    action: 'create' | 'update' | 'pause' | 'resume' | 'delete',
    ids: string[]
  ) {
    if (!ids.length) return;
    try {
      // 👇 Get current session and access token from Supabase JS client
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) {
        console.error('No access token available for match-jobs call:', sessionError);
        toast.error('Not authenticated for matching');
        return;
      }

      const accessToken = sessionData.session.access_token;

      const res = await fetch('/api/match-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 👇 Send token to backend
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action,
          catalog_item_ids: ids,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('Failed to enqueue match jobs: ', {
          status: res.status,
          statusText: res.statusText,
          body: text,
        });
        toast.error('Failed to queue matching job(s)');
        return;
      }

      const data = await res.json().catch(() => null);
      console.log('Enqueued match jobs:', data);
    } catch (err) {
      console.error('enqueueMatchJobs exception:', err);
      toast.error('Failed to queue matching job(s)');
    }
  }


  useEffect(() => {
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, searchTerm]);

  // Fetch products for a specific page (defaults to currentPage)
  async function fetchProducts(page: number = currentPage) {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      console.log('Logged in user id:', user?.id);
      if (!user) {
        setProducts([]);
        setLoading(false);
        return;
      }

      let supabaseQuery = supabase
        .from('catalog_items')
        .select('id, title, category, status, updated_at, user_id')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (searchTerm.trim() !== '') {
        supabaseQuery = supabaseQuery.or(
          `title.ilike.%${searchTerm}%,category.ilike.%${searchTerm}%`
        );
      }

      const from = (page - 1) * PAGE_SIZE;
      const to = page * PAGE_SIZE - 1;
      supabaseQuery = supabaseQuery.range(from, to);

      const { data: productsData, error } = await supabaseQuery;

      console.log('Fetched catalog_items:', productsData, 'Error:', error);

      if (error) {
        console.error('fetchProducts error:', error);
        setProducts([]);
        toast.error('Failed to load products');
      } else {
        setProducts(productsData || []);
      }
    } catch (err) {
      console.error('fetchProducts exception:', err);
      setProducts([]);
      toast.error('Failed to load products');
    } finally {
      setLoading(false);
      // Reset selection whenever page/search changes so UI stays consistent
      setSelectedIds({});
      setSelectedRadioId(null);
      setActionMode('none');
    }
  }

  // ---------- ADD PRODUCT ----------
  async function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !newCategory.trim()) return;
    setAdding(true);
    try {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user) {
        toast.error('Not authenticated');
        setAdding(false);
        return;
      }

      const res = await supabase
        .from('catalog_items')
        .insert([
          {
            title: newTitle.trim(),
            category: newCategory.trim(),
            status: 'active',
            user_id: user.id,
            updated_at: new Date().toISOString(),
          },
        ])
        .select();

      console.log('Insert response:', res);

      if (res.error) {
        console.error('Insert error:', res.error);
        toast.error('Failed to add product');
      } else {
        toast.success('Product added');

        // get the new catalog item id and enqueue a "create" match job
        const newItem = res.data?.[0];
        if (newItem?.id) {
          enqueueMatchJobs('create', [newItem.id]);
        }

        setCurrentPage(1);
        await fetchProducts(1);
      }
    } catch (err) {
      console.error('handleAddProduct exception:', err);
      toast.error('Failed to add product');
    } finally {
      setAdding(false);
      setShowAddModal(false);
      setNewTitle('');
      setNewCategory('');
    }
  }

  // ---------- EDIT (Modify single item) ----------
  function startModifyFlow() {
    setActionMode('modify');
    setSelectedIds({});
    setSelectedRadioId(null);
  }

  function onSelectRadio(id: string) {
    setSelectedRadioId(id);
    // prefill edit modal with the selected product
    const p = products.find((x) => x.id === id);
    if (p) {
      setEditId(p.id);
      setEditTitle(p.title);
      setEditCategory(p.category);
      // open a modal to edit
      setShowEditModal(true);
    }
  }

  async function handleSaveEdit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!editId) return;
    setEditing(true);
    try {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user) {
        toast.error('Not authenticated');
        setEditing(false);
        return;
      }

      const { error } = await supabase
        .from('catalog_items')
        .update({
          title: editTitle.trim(),
          category: editCategory.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', editId)
        .eq('user_id', user.id)
        .select();

      if (error) {
        console.error('Edit error:', error);
        toast.error('Failed to update product');
      } else {
        toast.success('Product updated');

        // enqueue an "update" match job for this item
        enqueueMatchJobs('update', [editId]);

        await fetchProducts(currentPage);
      }
    } catch (err) {
      console.error('handleSaveEdit exception:', err);
      toast.error('Failed to update product');
    } finally {
      setEditing(false);
      setShowEditModal(false);
      setEditId(null);
      setEditTitle('');
      setEditCategory('');
      setActionMode('none');
    }
  }

  // ---------- BULK Pause/Resume/Delete ----------
  function startBulk(mode: ActionMode) {
    setActionMode(mode);
    setSelectedIds({});
    setSelectedRadioId(null);
  }

  function toggleCheckbox(id: string) {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function clearSelectionMode() {
    setActionMode('none');
    setSelectedIds({});
    setSelectedRadioId(null);
  }

  function getSelectedIdList() {
    return Object.entries(selectedIds)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }

  async function applyPauseResume(status: 'paused' | 'active') {
    const ids = getSelectedIdList();
    if (ids.length === 0) {
      toast('No items selected', { icon: '⚠️' });
      return;
    }
    setProcessingBulk(true);
    try {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user) {
        toast.error('Not authenticated');
        setProcessingBulk(false);
        return;
      }

      const { error } = await supabase
        .from('catalog_items')
        .update({ status, updated_at: new Date().toISOString() })
        .in('id', ids)
        .eq('user_id', user.id);

      if (error) {
        console.error('Pause/Resume error:', error);
        toast.error('Failed to update items');
      } else {
        toast.success(`Updated ${ids.length} item(s)`);

        // enqueue "pause" or "resume" jobs for these items
        const action = status === 'paused' ? 'pause' : 'resume';
        enqueueMatchJobs(action, ids);

        await fetchProducts(currentPage);
      }
    } catch (err) {
      console.error('applyPauseResume exception:', err);
      toast.error('Failed to update items');
    } finally {
      setProcessingBulk(false);
      clearSelectionMode();
    }
  }

  // Prepare delete: confirm first
  function prepareDeleteSelected() {
    const ids = getSelectedIdList();
    if (ids.length === 0) {
      toast('No items selected', { icon: '⚠️' });
      return;
    }
    setDeleteTargetIds(ids);
    setShowDeleteConfirm(true);
  }

  // Perform hard delete
  async function performDeleteConfirmed() {
    setProcessingBulk(true);
    try {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user) {
        toast.error('Not authenticated');
        setProcessingBulk(false);
        return;
      }

      const ids = deleteTargetIds;

      // 👈 FIRST: enqueue deletion job
      await enqueueMatchJobs("delete", ids);

      // 👇 THEN: delete from catalog_items
      const { error } = await supabase
        .from('catalog_items')
        .delete()
        .in('id', ids)
        .eq('user_id', user.id);

      if (error) {
        console.error("Delete error:", error);
        toast.error("Failed to delete items");
      } else {
        toast.success(`Deleted ${ids.length} item(s)`);
        await fetchProducts(currentPage);
      }
    } catch (err) {
      console.error("performDeleteConfirmed exception:", err);
      toast.error("Failed to delete items");
    } finally {
      setProcessingBulk(false);
      setShowDeleteConfirm(false);
      setDeleteTargetIds([]);
      clearSelectionMode();
    }
  }


  // ---------- Pagination & Search handlers ----------
  function handlePrevPage() {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  }
  function handleNextPage() {
    if (products.length === PAGE_SIZE) setCurrentPage(currentPage + 1);
  }
  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCurrentPage(1);
    fetchProducts(1);
  }

  // ---------- UI helpers ----------
  const anySelected = Object.values(selectedIds).some(Boolean);

  // ---------- RENDER ----------
  return (
    <div className="p-8 bg-white min-h-screen">
      {/* Toaster for toast messages */}
      <Toaster position="top-right" />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-[#0E121A]">My Product Catalog</h1>
        <div className="flex items-center gap-4">
          {/* Primary Add button (yellow) */}
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 rounded-lg font-semibold shadow-sm transition text-[#0E121A] bg-[#F7C846] hover:bg-yellow-400 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            + Add Product
          </button>
        </div>
      </div>

      <form onSubmit={handleSearch}>
        <input
          type="search"
          placeholder="Search by Name or Category"
          className="border border-gray-400 rounded-lg p-3 w-full max-w-xs mb-6 bg-white text-gray-900 placeholder-gray-400"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </form>

      {/* Action toolbar (shows buttons to enter selection modes) */}
      <div className="flex gap-3 items-center mb-4 flex-wrap">
        {/* Outline buttons */}
        <button
          className={`px-3 py-2 rounded-lg font-medium border border-gray-300 bg-white hover:bg-gray-50 transition ${
            actionMode === 'modify' ? 'ring-2 ring-[#F7C846]' : ''
          }`}
          onClick={startModifyFlow}
          type="button"
        >
          Modify (single)
        </button>

        <button
          className={`px-3 py-2 rounded-lg font-medium border border-gray-300 bg-white hover:bg-gray-50 transition ${
            actionMode === 'bulk-pause' ? 'ring-2 ring-[#F7C846]' : ''
          }`}
          onClick={() => startBulk('bulk-pause')}
          type="button"
        >
          Pause Selected
        </button>

        <button
          className={`px-3 py-2 rounded-lg font-medium border border-gray-300 bg-white hover:bg-gray-50 transition ${
            actionMode === 'bulk-resume' ? 'ring-2 ring-[#F7C846]' : ''
          }`}
          onClick={() => startBulk('bulk-resume')}
          type="button"
        >
          Resume Selected
        </button>

        <button
          className={`px-3 py-2 rounded-lg font-medium border border-gray-300 bg-white hover:bg-gray-50 transition ${
            actionMode === 'bulk-delete' ? 'ring-2 ring-[#F7C846]' : ''
          }`}
          onClick={() => startBulk('bulk-delete')}
          type="button"
        >
          Delete Selected
        </button>

        <button
          className="px-3 py-2 rounded-lg font-medium border border-gray-300 bg-gray-100 hover:bg-gray-200 transition ml-2"
          onClick={clearSelectionMode}
          type="button"
        >
          Cancel Selection
        </button>

        {/* Apply buttons - only visible for bulk modes */}
        {actionMode === 'bulk-pause' && (
          <button
            onClick={() => applyPauseResume('paused')}
            disabled={!anySelected || processingBulk}
            className="ml-auto px-3 py-2 rounded-lg font-semibold shadow-sm transition text-[#0E121A] bg-[#F7C846] hover:bg-yellow-400 disabled:opacity-60 disabled:cursor-not-allowed"
            type="button"
          >
            Apply Pause
          </button>
        )}
        {actionMode === 'bulk-resume' && (
          <button
            onClick={() => applyPauseResume('active')}
            disabled={!anySelected || processingBulk}
            className="ml-auto px-3 py-2 rounded-lg font-semibold shadow-sm transition text-[#0E121A] bg-[#8AE98D] hover:bg-green-300 disabled:opacity-60 disabled:cursor-not-allowed"
            type="button"
          >
            Apply Resume
          </button>
        )}
        {actionMode === 'bulk-delete' && (
          <button
            onClick={prepareDeleteSelected}
            disabled={!anySelected || processingBulk}
            className="ml-auto px-3 py-2 rounded-lg font-semibold shadow-sm transition text-white bg-[#FC574E] hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
            type="button"
          >
            Confirm Delete
          </button>
        )}
      </div>

      {/* Loading skeleton or table */}
      {loading ? (
        // simple table skeleton
        <div className="animate-pulse space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-100 rounded" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <p className="mt-6 text-lg text-gray-700 font-semibold">
          No products found. Click{' '}
          <span className="text-[#F7C846] font-semibold">'Add Product'</span> to get started.
        </p>
      ) : (
        <>
          <table className="w-full border border-gray-300 bg-white text-gray-900">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 p-3 text-left font-semibold">#</th>
                <th className="border border-gray-300 p-3 text-left font-semibold">Product Name</th>
                <th className="border border-gray-300 p-3 text-left font-semibold">Category</th>
                <th className="border border-gray-300 p-3 text-left font-semibold">Status</th>
                <th className="border border-gray-300 p-3 text-left font-semibold">Updated At</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product, idx) => (
                <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                  <td className="border border-gray-200 p-3">
                    {/* Show checkbox or radio depending on actionMode */}
                    {actionMode === 'modify' ? (
                      <input
                        type="radio"
                        name="editRadio"
                        checked={selectedRadioId === product.id}
                        onChange={() => onSelectRadio(product.id)}
                        className="mr-2"
                      />
                    ) : actionMode === 'bulk-pause' ||
                      actionMode === 'bulk-resume' ||
                      actionMode === 'bulk-delete' ? (
                      <input
                        type="checkbox"
                        checked={!!selectedIds[product.id]}
                        onChange={() => toggleCheckbox(product.id)}
                        className="mr-2"
                      />
                    ) : (
                      <span className="text-sm text-gray-500">
                        {(currentPage - 1) * PAGE_SIZE + idx + 1}
                      </span>
                    )}
                  </td>

                  <td className="border border-gray-200 p-3">{product.title}</td>
                  <td className="border border-gray-200 p-3">{product.category}</td>
                  <td className="border border-gray-200 p-3 capitalize">{product.status}</td>
                  <td className="border border-gray-200 p-3">
                    {new Date(product.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Bulk action hint area + pagination */}
          <div className="flex items-center justify-between mt-6 max-w-full gap-4">
            <div className="text-sm text-gray-700">
              {actionMode === 'none' ? (
                'Select an action above to edit, pause/resume or delete items.'
              ) : actionMode === 'modify' ? (
                'Select one item (radio) to modify.'
              ) : (
                <span>{Object.values(selectedIds).filter(Boolean).length} selected</span>
              )}
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={handlePrevPage}
                disabled={currentPage === 1}
                className="px-4 py-2 bg-gray-200 text-[#0E121A] rounded disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-[#0E121A] font-semibold px-2">Page {currentPage}</span>
              <button
                onClick={handleNextPage}
                disabled={products.length < PAGE_SIZE}
                className="px-4 py-2 bg-gray-200 text-[#0E121A] rounded disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* ADD PRODUCT MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-30 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-lg p-8 min-w-[350px]">
            <h2 className="text-xl font-semibold text-[#0E121A] mb-4">Add Product</h2>
            <form onSubmit={handleAddProduct}>
              <input
                type="text"
                className="w-full border border-gray-400 rounded-lg p-3 mb-4 bg-white text-gray-900 placeholder-gray-400"
                placeholder="Product Name"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                required
              />
              <input
                type="text"
                className="w-full border border-gray-400 rounded-lg p-3 mb-5 bg-white text-gray-900 placeholder-gray-400"
                placeholder="Product Category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                required
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-5 py-2 rounded-lg bg-gray-200 text-gray-700 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                  onClick={() => setShowAddModal(false)}
                  disabled={adding}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg font-semibold shadow-sm transition text-[#0E121A] bg-[#F7C846] hover:bg-yellow-400 disabled:opacity-60 disabled:cursor-not-allowed"
                  disabled={adding}
                >
                  {adding ? 'Adding...' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-30 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-lg p-8 min-w-[350px]">
            <h2 className="text-xl font-semibold text-[#0E121A] mb-4">Edit Product</h2>
            <form onSubmit={handleSaveEdit}>
              <input
                type="text"
                className="w-full border border-gray-400 rounded-lg p-3 mb-4 bg-white text-gray-900 placeholder-gray-400"
                placeholder="Product Name"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
              />
              <input
                type="text"
                className="w-full border border-gray-400 rounded-lg p-3 mb-5 bg-white text-gray-900 placeholder-gray-400"
                placeholder="Product Category"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                required
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-5 py-2 rounded-lg bg-gray-200 text-gray-700 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                  onClick={() => {
                    setShowEditModal(false);
                    setActionMode('none');
                    setSelectedRadioId(null);
                  }}
                  disabled={editing}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg font-semibold shadow-sm transition text-[#0E121A] bg-[#F7C846] hover:bg-yellow-400 disabled:opacity-60 disabled:cursor-not-allowed"
                  disabled={editing}
                >
                  {editing ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-60 bg-black bg-opacity-30 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-lg p-8 min-w-[320px]">
            <h3 className="text-lg font-semibold mb-4 text-[#0E121A]">Confirm Delete</h3>
            <p className="mb-6 text-sm text-gray-700">
              Are you sure you want to permanently delete {deleteTargetIds.length} item(s)? This
              action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded bg-gray-200 disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => {
                  setShowDeleteConfirm(false);
                }}
                disabled={processingBulk}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded bg-[#FC574E] text-white disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={performDeleteConfirmed}
                disabled={processingBulk}
              >
                {processingBulk ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
