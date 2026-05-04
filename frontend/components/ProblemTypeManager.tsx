import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Save, X, Tag, AlertCircle, CheckCircle } from 'lucide-react';
import { getAdminProblemTypes, createProblemType, updateProblemType, deleteProblemType } from '../services/api';

interface ProblemType {
    id: number;
    name: string;
    description?: string;
}

interface ProblemTypeManagerProps {
    theme: 'dark' | 'light';
    token: string;
    onBack: () => void;
}

const ProblemTypeManager: React.FC<ProblemTypeManagerProps> = ({ theme, token, onBack }) => {
    const [types, setTypes] = useState<ProblemType[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Modal State
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);

    // Form State
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    // Edit State
    const [editName, setEditName] = useState('');
    const [editDescription, setEditDescription] = useState('');

    useEffect(() => {
        loadTypes();
    }, []);

    const loadTypes = async () => {
        setLoading(true);
        try {
            const data = await getAdminProblemTypes(token);
            setTypes(data);
        } catch (err: any) {
            setError(err.message || 'Failed to load problem types');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!name.trim()) {
            setError('Tên loại bài tập là bắt buộc');
            return;
        }
        setError(null);
        setSuccess(null);
        try {
            await createProblemType(token, { name, description });
            setSuccess('Tạo loại bài tập thành công');
            setShowCreateModal(false);
            setName('');
            setDescription('');
            loadTypes();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const startEdit = (type: ProblemType) => {
        setEditingId(type.id);
        setEditName(type.name);
        setEditDescription(type.description || '');
    };

    const handleUpdate = async (id: number) => {
        if (!editName.trim()) {
            setError('Tên loại bài tập là bắt buộc');
            return;
        }
        setError(null);
        setSuccess(null);
        try {
            await updateProblemType(token, id, { name: editName, description: editDescription });
            setSuccess('Cập nhật thành công');
            setEditingId(null);
            loadTypes();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleDelete = async (type: ProblemType) => {
        if (!confirm(`Bạn có chắc muốn xóa loại bài tập "${type.name}"?`)) return;
        setError(null);
        setSuccess(null);
        try {
            await deleteProblemType(token, type.id);
            setSuccess('Xóa thành công');
            loadTypes();
        } catch (err: any) {
            setError(err.message);
        }
    };

    return (
        <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#09090b] text-zinc-100' : 'bg-gray-50 text-gray-900'}`}>
            {/* Header */}
            <div className={`sticky top-0 z-20 backdrop-blur-xl border-b transition-colors duration-300 ${theme === 'dark' ? 'border-white/10 bg-[#09090b]/80' : 'border-gray-200/50 bg-white/70'}`}>
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={onBack}
                                className={`group flex items-center gap-2 text-sm font-medium transition-colors ${theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                <div className={`p-1.5 rounded-full transition-colors ${theme === 'dark' ? 'bg-white/5 group-hover:bg-white/10' : 'bg-black/5 group-hover:bg-black/10'}`}>
                                    ←
                                </div>
                                Quay lại
                            </button>
                            <div className="h-6 w-px bg-current opacity-10 mx-2" />
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/10">
                                    <Tag className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h1 className="text-xl font-bold tracking-tight">Quản lý Loại bài tập</h1>
                                    <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {types.length} loại bài tập
                                    </p>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl text-sm font-medium hover:shadow-lg hover:shadow-indigo-500/25 transition-all duration-200 active:scale-95"
                        >
                            <Plus size={18} />
                            Thêm mới
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
                {/* Alerts */}
                {error && (
                    <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-500 animate-in fade-in slide-in-from-top-2">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <span className="font-medium">{error}</span>
                        <button onClick={() => setError(null)} className="ml-auto opacity-70 hover:opacity-100">
                            <X size={18} />
                        </button>
                    </div>
                )}

                {success && (
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 text-emerald-500 animate-in fade-in slide-in-from-top-2">
                        <CheckCircle className="w-5 h-5 flex-shrink-0" />
                        <span className="font-medium">{success}</span>
                        <button onClick={() => setSuccess(null)} className="ml-auto opacity-70 hover:opacity-100">
                            <X size={18} />
                        </button>
                    </div>
                )}

                {/* List */}
                {loading ? (
                    <div className="grid gap-4">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className={`h-20 rounded-2xl animate-pulse ${theme === 'dark' ? 'bg-white/5' : 'bg-gray-100'}`} />
                        ))}
                    </div>
                ) : (
                    <div className="grid gap-4">
                        {types.length === 0 ? (
                            <div className={`text-center py-10 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                                Chưa có loại bài tập nào. Hãy tạo mới!
                            </div>
                        ) : (
                            types.map(type => (
                                <div
                                    key={type.id}
                                    className={`p-5 rounded-2xl border transition-all ${theme === 'dark' ? 'bg-gray-800/40 border-white/5 hover:border-white/10' : 'bg-white border-gray-100 shadow-sm hover:shadow-md'}`}
                                >
                                    {editingId === type.id ? (
                                        <div className="flex flex-col md:flex-row gap-4 items-start">
                                            <div className="flex-1 w-full space-y-3">
                                                <input
                                                    value={editName}
                                                    onChange={(e) => setEditName(e.target.value)}
                                                    className={`w-full px-4 py-2 rounded-xl border outline-none ${theme === 'dark' ? 'bg-black/20 border-white/10' : 'bg-gray-50 border-gray-200'}`}
                                                    placeholder="Tên loại bài tập"
                                                />
                                                <input
                                                    value={editDescription}
                                                    onChange={(e) => setEditDescription(e.target.value)}
                                                    className={`w-full px-4 py-2 rounded-xl border outline-none ${theme === 'dark' ? 'bg-black/20 border-white/10' : 'bg-gray-50 border-gray-200'}`}
                                                    placeholder="Mô tả..."
                                                />
                                            </div>
                                            <div className="flex items-center gap-2 self-end md:self-center">
                                                <button onClick={() => setEditingId(null)} className={`p-2 rounded-lg ${theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}>Hủy</button>
                                                <button onClick={() => handleUpdate(type.id)} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500">Lưu</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="text-lg font-semibold">{type.name}</h3>
                                                <p className={`text-sm mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>{type.description || 'Không có mô tả'}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => startEdit(type)}
                                                    className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-white/10 text-blue-400' : 'hover:bg-gray-100 text-blue-600'}`}
                                                >
                                                    <Edit size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(type)}
                                                    className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-50 text-red-600'}`}
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={() => setShowCreateModal(false)}
                    />
                    <div className={`relative w-full max-w-md rounded-2xl shadow-2xl p-6 ${theme === 'dark' ? 'bg-gray-900 border border-white/10' : 'bg-white'}`}>
                        <h2 className="text-xl font-bold mb-4">Thêm loại bài tập mới</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Tên loại <span className="text-red-500">*</span></label>
                                <input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className={`w-full px-4 py-2 rounded-xl border outline-none ${theme === 'dark' ? 'bg-gray-800 border-white/10' : 'bg-gray-50 border-gray-200'}`}
                                    placeholder="Ví dụ: Đệ quy, Quy hoạch động..."
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Mô tả</label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    rows={3}
                                    className={`w-full px-4 py-2 rounded-xl border outline-none ${theme === 'dark' ? 'bg-gray-800 border-white/10' : 'bg-gray-50 border-gray-200'}`}
                                    placeholder="Mô tả ngắn gọn về loại bài tập này..."
                                />
                            </div>
                            <div className="flex justify-end gap-3 pt-2">
                                <button onClick={() => setShowCreateModal(false)} className={`px-4 py-2 rounded-lg ${theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}>Hủy</button>
                                <button onClick={handleCreate} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500">Tạo mới</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProblemTypeManager;
