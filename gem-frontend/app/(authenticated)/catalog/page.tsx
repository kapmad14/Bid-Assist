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

type CategoryIndexRow = {
  raw: string;
  lower: string;
};

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

  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [categoryIndex, setCategoryIndex] = useState<CategoryIndexRow[]>([]);

  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([]);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);

  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number>(-1);


  // Page Loading
  const [loading, setLoading] = useState(false);
  const TOOLBAR_BTN_BASE =
  'h-10 px-4 rounded-lg text-sm font-medium transition border border-gray-300 bg-white hover:bg-gray-50 shadow-sm';
  const mountedRef = useRef(false);
  const categoryTimerRef = useRef<any>(null);

  const addSuggestBoxRef = useRef<HTMLDivElement | null>(null);
  const editSuggestBoxRef = useRef<HTMLDivElement | null>(null);

  const suggestionItemRefs = useRef<(HTMLDivElement | null)[]>([]);


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
  // Load category master list
  // -------------------------------------
  useEffect(() => {
    async function loadCategories() {
      try {
        const res = await fetch('/api/category-list');
        const data = await res.json();
        setAllCategories(data.categories || []);
        console.log('Loaded categories:', data.categories?.length);
      } catch (e) {
        console.error('Failed to load categories', e);
      }
    }

    loadCategories();
  }, []);

  // -------------------------------------
  // Build normalized category index
  // -------------------------------------
  useEffect(() => {
    if (!allCategories.length) return;

    const idx: CategoryIndexRow[] = allCategories.map(c => ({
      raw: c,
      lower: c.toLowerCase(),
    }));


    setCategoryIndex(idx);
    console.log('Category index built:', idx.length);

  }, [allCategories]);

  // -------------------------------------
  // Lightweight fuzzy token match
  // -------------------------------------
  function fuzzyTokenMatch(q: string, target: string) {
    const qTokens = q.split(/\s+/);
    const t = target;

    let score = 0;

    for (const token of qTokens) {
      if (t.includes(token)) {
        score += 2;
        continue;
      }

      // prefix match
      if (t.startsWith(token)) {
        score += 1.5;
        continue;
      }

      // loose partial (first 3 chars)
      if (token.length >= 4 && t.includes(token.slice(0, 3))) {
        score += 1;
      }
    }

    return score;
  }


  // -------------------------------------
  // Category suggestion matcher (3+ chars)
  // -------------------------------------
  function computeCategorySuggestions(input: string) {
    const q = input.trim().toLowerCase();

    if (q.length < 3) {
      setCategorySuggestions([]);
      setShowCategorySuggestions(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    const qTokens = q.split(/\s+/);

    const bucketStartsWithFull: string[] = [];
    const bucketStartsWithToken: string[] = [];
    const bucketContainsFull: string[] = [];
    const bucketContainsToken: string[] = [];
    const bucketFuzzy: { raw: string; score: number }[] = [];


    for (let i = 0; i < categoryIndex.length; i++) {
      const raw = categoryIndex[i].raw;
      const t = categoryIndex[i].lower;

      // Tier 1 — startsWith full query
      if (t.startsWith(q)) {
        bucketStartsWithFull.push(raw);
        continue;
      }

      // Tier 2 — startsWith any token
      if (qTokens.some(tok => t.startsWith(tok))) {
        bucketStartsWithToken.push(raw);
        continue;
      }

      // Tier 3 — contains full query
      if (t.includes(q)) {
        bucketContainsFull.push(raw);
        continue;
      }

      // Tier 4 — contains any token
      if (qTokens.some(tok => t.includes(tok))) {
        bucketContainsToken.push(raw);
        continue;
      }

      // Tier 5 — fuzzy fallback
      const fuzzyScore = fuzzyTokenMatch(q, t);
      if (fuzzyScore > 0) {
        bucketFuzzy.push({ raw, score: fuzzyScore });
      }
    }

    // fuzzy bucket sort only (keep deterministic order above it)
    bucketFuzzy.sort((a, b) => b.score - a.score);

    // merge buckets in strict priority order
    const merged = [
      ...bucketStartsWithFull,
      ...bucketStartsWithToken,
      ...bucketContainsFull,
      ...bucketContainsToken,
      ...bucketFuzzy.map(x => x.raw),
    ];

    // remove duplicates while preserving order
    const seen = new Set<string>();
    const deduped: string[] = [];

    for (const v of merged) {
      if (!seen.has(v)) {
        seen.add(v);
        deduped.push(v);
      }
    }

    // final top 10
    const out = deduped.slice(0, 10);

    setCategorySuggestions(out);
    setShowCategorySuggestions(true);
    setActiveSuggestionIndex(-1);
    suggestionItemRefs.current = [];
  }

  // -------------------------------------
  // Highlight match helper
  // -------------------------------------
  function highlightMatch(text: string, query: string) {
    if (!query || query.length < 3) return text;

    const q = query.trim().toLowerCase();
    const idx = text.toLowerCase().indexOf(q);

    if (idx === -1) return text;

    return (
      <>
        {text.slice(0, idx)}
        <span className="font-semibold text-blue-700">
          {text.slice(idx, idx + q.length)}
        </span>
        {text.slice(idx + q.length)}
      </>
    );
  }

  // -------------------------------------
  // Close suggestions on outside click
  // -------------------------------------
  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      const target = e.target as Node;

      if (
        addSuggestBoxRef.current &&
        addSuggestBoxRef.current.contains(target)
      ) return;

      if (
        editSuggestBoxRef.current &&
        editSuggestBoxRef.current.contains(target)
      ) return;

      setShowCategorySuggestions(false);
      setActiveSuggestionIndex(-1);
    }

    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, []);


  // -------------------------------------
  // Auto scroll active suggestion into view
  // -------------------------------------
  useEffect(() => {
    if (activeSuggestionIndex < 0) return;

    const el = suggestionItemRefs.current[activeSuggestionIndex];
    if (el) {
      el.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [activeSuggestionIndex]);

  // -------------------------------------
  // Clamp active index when suggestions change
  // -------------------------------------
  useEffect(() => {
    if (activeSuggestionIndex >= categorySuggestions.length) {
      setActiveSuggestionIndex(
        categorySuggestions.length ? categorySuggestions.length - 1 : -1
      );
    }
  }, [categorySuggestions, activeSuggestionIndex]);

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
        // 1️⃣ Active first, paused later
        .order('status', { ascending: true }) // active comes before paused alphabetically
        // 2️⃣ Newest first inside each group
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

  function handleAddCategoryInput(val: string) {
    setNewCategory(val);

    clearTimeout(categoryTimerRef.current);

    categoryTimerRef.current = setTimeout(() => {
      computeCategorySuggestions(val);
    }, 200);
  }

  function handleEditCategoryInput(val: string) {
    setEditCategory(val);

    clearTimeout(categoryTimerRef.current);

    categoryTimerRef.current = setTimeout(() => {
      computeCategorySuggestions(val);
    }, 200);
  }

  function handleSuggestionKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    mode: 'add' | 'edit'
  ) {
    if (!showCategorySuggestions || categorySuggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestionIndex(i =>
        i < categorySuggestions.length - 1 ? i + 1 : i
      );
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIndex(i => (i > 0 ? i - 1 : 0));
    }

    if (e.key === 'Enter') {
      if (activeSuggestionIndex >= 0) {
        e.preventDefault();
        const value = categorySuggestions[activeSuggestionIndex];

        if (mode === 'add') setNewCategory(value);
        else setEditCategory(value);

        setShowCategorySuggestions(false);
        setActiveSuggestionIndex(-1);
        suggestionItemRefs.current = [];
      }
    }

    if (e.key === 'Escape') {
      setShowCategorySuggestions(false);
      setActiveSuggestionIndex(-1);
      suggestionItemRefs.current = [];
    }
  }


  // -------------------------------------
  // Add Product
  // -------------------------------------
  async function handleAddProduct(e: any) {
    e.preventDefault();

    if (!newCategory.trim()) {
      toast.error('Category is required');
      return;
    }



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
          title: newTitle.trim() || null,
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

      toast.success('Product / Service added! TenderBot will start scanning tenders within a few minutes.');

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

    if (!editCategory.trim()) {
      toast.error('Category is required');
      return;
    }

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
          title: editTitle.trim() || null,
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
        return 'Select a product / service using the radio button to edit its details.';
      case 'bulk-pause':
        return 'Select one or more products / services to pause recommendations for them.';
      case 'bulk-resume':
        return 'Select one or more paused products / services to resume recommendations.';
      case 'bulk-delete':
        return 'Select products / services you want to permanently remove from your catalogue.';
      default:
        return 'Use the tools above to manage which products / services are used for tender recommendations.';
    }
  }

  // -------------------------------------
  // Render
  // -------------------------------------

  const hasSelection = Object.values(selectedIds).some(Boolean);

  return (
    <div className="p-8 bg-white min-h-screen">
      <Toaster position="top-right" />

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">My Catalogue</h1>
          <p className="text-sm text-gray-500 mt-1">
            {products.length} products actively monitored
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="h-11 px-6 rounded-xl bg-yellow-400 text-gray-900 font-semibold shadow-sm
                    hover:bg-yellow-500 hover:shadow-md transition active:scale-[0.98]"
        >
          + Add Product / Service
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

      {products.length > 0 && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-3 mb-4">
            {/* Modify */}
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

            {/* Pause */}
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
              className={`${TOOLBAR_BTN_WIDTH} px-3 py-1.5 rounded-lg text-sm font-medium transition
                ${actionMode !== 'bulk-pause'
                  ? 'border border-gray-300 hover:bg-gray-50'
                  : !Object.values(selectedIds).some(Boolean)
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-amber-500 text-white ring-2 ring-amber-300 hover:bg-amber-600'}
              `}
            >
              {actionMode === 'bulk-pause' ? 'Apply Pause' : 'Pause'}
            </button>

            {/* Resume */}
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
              className={`${TOOLBAR_BTN_WIDTH} px-3 py-1.5 rounded-lg text-sm font-medium transition
                ${actionMode !== 'bulk-resume'
                  ? 'border border-gray-300 hover:bg-gray-50'
                  : !Object.values(selectedIds).some(Boolean)
                    ? 'bg-green-100 text-green-800'
                    : 'bg-green-500 text-white ring-2 ring-green-300 hover:bg-green-600'}
              `}
            >
              {actionMode === 'bulk-resume' ? 'Apply Resume' : 'Resume'}
            </button>

            {/* Delete */}
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
              className={`${TOOLBAR_BTN_WIDTH} px-3 py-1.5 rounded-lg text-sm font-medium transition
                ${actionMode !== 'bulk-delete'
                  ? 'border border-gray-300 hover:bg-gray-50'
                  : !Object.values(selectedIds).some(Boolean)
                    ? 'bg-red-100 text-red-800'
                    : 'bg-red-500 text-white ring-2 ring-red-300 hover:bg-red-600'}
              `}
            >
              {actionMode === 'bulk-delete' ? 'Confirm Delete' : 'Delete'}
            </button>
          </div>

          {/* Info Tip */}
          <div className="mt-3 mb-6 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-2 text-sm text-blue-700">
            <Info className="w-4 h-4 text-blue-500" />
            <span className="font-medium">{getToolbarHint(actionMode)}</span>
          </div>
        </>
      )}


      
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
              Your catalogue is empty
            </h2>

            <p className="mt-3 text-gray-600">
              Add your products or services to start receiving relevant tender matches automatically.
              This is the foundation of how TenderBot works.
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
                <th className="p-3 border border-gray-300 text-center">Product / Service Name</th>
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
        <Modal title="Add Product / Service" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleAddProduct}>
              <Input value={newTitle} onChange={setNewTitle} placeholder="Product / Service Name (Optional)" />
              <p className="text-xs text-gray-500 mb-3">
                Example: "Crocin", "Asian Paints", "Dell"
              </p>

              <div className="relative">
                <Input
                  value={newCategory}
                  onChange={handleAddCategoryInput}
                  onKeyDown={(e) => handleSuggestionKeyDown(e, 'add')}
                  placeholder="Category (Required)"
                  required
                  onFocus={() => {
                    if (newCategory.trim().length >= 3) setShowCategorySuggestions(true);
                  }}
                  onBlur={() => setTimeout(() => setShowCategorySuggestions(false), 150)}
                />

                {showCategorySuggestions && categorySuggestions.length > 0 && (
                  <div
                    ref={addSuggestBoxRef}
                    className="absolute z-50 w-full bg-white border rounded-lg shadow max-h-60 overflow-auto"
                  >
                    {categorySuggestions.map((s, index) => (
                      <div
                        key={s}
                        ref={(el) => {
                          suggestionItemRefs.current[index] = el;
                        }}
                        className={`px-3 py-2 cursor-pointer text-sm
                          ${index === activeSuggestionIndex
                            ? 'bg-blue-100'
                            : 'hover:bg-gray-100'}
                        `}
                        onMouseDown={() => {
                          setNewCategory(s);
                          setShowCategorySuggestions(false);
                          setActiveSuggestionIndex(-1);
                          suggestionItemRefs.current = [];
                        }}
                      >
                        {highlightMatch(s, newCategory)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-500 mb-3">
                Example: “Hospital Bed”, “Facility Management Service”, “Manpower Outsourcing Services”
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
        <Modal title="Edit Product / Service" onClose={() => setShowEditModal(false)}>
          <form onSubmit={handleSaveEdit}>
            <Input value={editTitle} onChange={setEditTitle} placeholder="Product / Service Name (Optional)" />
            <div className="relative">
              <Input
                value={editCategory}
                onChange={handleEditCategoryInput}
                onKeyDown={(e) => handleSuggestionKeyDown(e, 'edit')}
                placeholder="Product / Service Category"
                required
                onFocus={() => {
                  if (editCategory.trim().length >= 3) setShowCategorySuggestions(true);
                }}
                onBlur={() => setTimeout(() => setShowCategorySuggestions(false), 150)}
              />

              {showCategorySuggestions && categorySuggestions.length > 0 && (
                <div
                  ref={editSuggestBoxRef}
                  className="absolute z-50 w-full bg-white border rounded-lg shadow max-h-60 overflow-auto"
                >
                  {categorySuggestions.map((s, index) => (
                    <div
                      key={s}
                      ref={(el) => {
                        suggestionItemRefs.current[index] = el;
                      }}
                      className={`px-3 py-2 cursor-pointer text-sm
                        ${index === activeSuggestionIndex
                          ? 'bg-blue-100'
                          : 'hover:bg-gray-100'}
                      `}
                      onMouseDown={() => {
                        setEditCategory(s);
                        setShowCategorySuggestions(false);
                        setActiveSuggestionIndex(-1);
                        suggestionItemRefs.current = [];
                      }}
                    >
                      {highlightMatch(s, editCategory)}
                    </div>
                  ))}
                </div>
              )}
            </div>


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

type InputProps =
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
    value: string;
    onChange: (v: string) => void;
  };

function Input({ value, onChange, ...props }: InputProps) {
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
