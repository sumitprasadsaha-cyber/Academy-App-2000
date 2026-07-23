import React, { useState, useMemo, useRef } from "react";
import { 
  ArrowLeft, 
  Plus, 
  FileText, 
  Trash2, 
  BookOpen, 
  Upload,
  Eye,
  X,
  Pencil,
  Search
} from "lucide-react";
import { ChapterNote } from "../types";
import { uploadPdfToStorage, downloadFileFromStorage, sanitizeStoragePath, getBucketName } from "../lib/storageService";
import PdfViewer from "./PdfViewer";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

interface SubjectNotesProps {
  subject: string;
  studentName: string;
  studentId?: string;
  notes: ChapterNote[];
  onBack: () => void;
  onAddNote: (chapterNo: number, chapterName: string, pdfUrl: string, pdfFileName: string) => void;
  onEditNote?: (noteId: string, newChapterNo: number, newChapterName: string) => Promise<void> | void;
  onDeleteNote: (noteId: string) => void;
  isAdmin?: boolean;
  enrolledSubjects?: string[];
  onSelectSubject?: (subject: string) => void;
}

export default function SubjectNotes({
  subject,
  studentName,
  studentId,
  notes,
  onBack,
  onAddNote,
  onEditNote,
  onDeleteNote,
  isAdmin = true,
  enrolledSubjects = [],
  onSelectSubject
}: SubjectNotesProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [chapterNo, setChapterNo] = useState<number | "">("");
  const [chapterName, setChapterName] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfName, setPdfName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");

  // Edit Chapter Modal state
  const [editingNote, setEditingNote] = useState<ChapterNote | null>(null);
  const [editChapterNo, setEditChapterNo] = useState<number | "">("");
  const [editChapterName, setEditChapterName] = useState("");
  const [isEditingSaving, setIsEditingSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // PDF Preview state
  const [activePreviewPdf, setActivePreviewPdf] = useState<{
    url: string;
    title: string;
    noteId?: string;
    storagePath?: string;
    bucket?: string;
  } | null>(null);

  // Delete Confirmation Modal state
  const [deleteModalNoteId, setDeleteModalNoteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filtering notes by Subject, Chapter Number, Chapter Name, or PDF file name
  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return notes;
    return notes.filter((note) => {
      const matchSubject = subject.toLowerCase().includes(query);
      const matchChNo = `chapter ${note.chapterNo}`.toLowerCase().includes(query) || `${note.chapterNo}`.includes(query);
      const matchChName = (note.chapterName || "").toLowerCase().includes(query);
      const matchFileName = (note.pdfFileName || "").toLowerCase().includes(query);
      return matchSubject || matchChNo || matchChName || matchFileName;
    });
  }, [notes, searchQuery, subject]);

  // Grouping PDFs under their respective chapter and sorting chapters numerically
  interface ChapterGroup {
    chapterNo: number;
    chapterName: string;
    notes: ChapterNote[];
  }

  const groupedChapterNotes = useMemo(() => {
    const groupsMap = new Map<number, ChapterGroup>();

    for (const note of filteredNotes) {
      const chNo = Number(note.chapterNo) || 0;
      if (!groupsMap.has(chNo)) {
        groupsMap.set(chNo, {
          chapterNo: chNo,
          chapterName: note.chapterName || `Chapter ${chNo}`,
          notes: []
        });
      }
      const group = groupsMap.get(chNo)!;
      if (note.chapterName && (!group.chapterName || group.chapterName.startsWith("Chapter"))) {
        group.chapterName = note.chapterName;
      }
      group.notes.push(note);
    }

    // Sort chapters by Chapter Number in ascending numerical order
    const result = Array.from(groupsMap.values()).sort((a, b) => a.chapterNo - b.chapterNo);

    // If multiple PDFs exist within the same chapter, sort their names alphabetically (A-Z)
    for (const group of result) {
      group.notes.sort((a, b) => {
        const nameA = (a.pdfFileName || a.chapterName || "").toLowerCase();
        const nameB = (b.pdfFileName || b.chapterName || "").toLowerCase();
        return nameA.localeCompare(nameB);
      });
    }

    return result;
  }, [filteredNotes]);

  const formatDate = (value?: string) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  };

  const handlePreviewPdf = (note: ChapterNote) => {
    if (!note.pdfUrl) return;
    let url = note.pdfUrl;
    let storagePath = note.storagePath;
    let bucket = note.bucket;
    if (url.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(url);
        url = parsed.storagePath || parsed.downloadUrl || parsed.url || url;
        storagePath = parsed.storagePath || storagePath;
        bucket = parsed.bucket || bucket;
      } catch (e) {
        // ignore
      }
    }
    setActivePreviewPdf({
      url,
      title: `Chapter ${note.chapterNo} - ${note.chapterName}`,
      noteId: note.id,
      storagePath: storagePath || url,
      bucket: bucket
    });
  };

  const handlePdfUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== "application/pdf") {
        setError("Only PDF document files are supported.");
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        setError("File size exceeds the 50MB limit.");
        return;
      }
      setPdfFile(file);
      setPdfName(file.name);
      setError("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!chapterNo || Number(chapterNo) <= 0) {
      setError("Please specify a valid Chapter Number");
      return;
    }
    if (!chapterName.trim()) {
      setError("Please specify a Chapter Name");
      return;
    }
    if (!pdfFile) {
      setError("Please upload a PDF notes file");
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress(0);
      setError("");

      const uploadedUrl = await uploadPdfToStorage(
        studentId || "sandbox",
        subject,
        pdfName,
        pdfFile,
        (progress) => setUploadProgress(progress)
      );

      onAddNote(
        Number(chapterNo),
        chapterName.trim(),
        uploadedUrl,
        pdfName
      );

      // Reset form
      setChapterNo("");
      setChapterName("");
      setPdfFile(null);
      setPdfName("");
      setIsAdding(false);
      setError("");
    } catch (err: any) {
      setError(err.message || "Failed to upload file");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleCancel = () => {
    setChapterNo("");
    setChapterName("");
    setPdfFile(null);
    setPdfName("");
    setIsAdding(false);
    setError("");
    setUploadProgress(0);
  };

  return (
    <div className="flex flex-col gap-5 pb-24 animate-fadeIn" id="subject-notes-view">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 pb-4" id="notes-header">
        <button
          onClick={onBack}
          className="p-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl transition-all cursor-pointer"
          id="btn-back-to-details"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider">
            {studentName} • Subject Notes
          </span>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 -mt-0.5">
            {subject}
          </h1>
        </div>
      </div>

      {/* Two-Panel Responsive Grid */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-start" id="notes-two-panel-container">
        
        {/* Left Panel: Subject Picker */}
        {enrolledSubjects && enrolledSubjects.length > 0 && (
          <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0 shrink-0 scrollbar-none" id="notes-left-subject-panel">
            {enrolledSubjects.map((sub) => {
              const isActive = sub === subject;
              return (
                <button
                  key={sub}
                  onClick={() => onSelectSubject?.(sub)}
                  className={`px-3.5 py-2.5 text-xs sm:text-sm font-bold rounded-xl border text-left whitespace-nowrap transition-all cursor-pointer ${
                    isActive 
                      ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-500/15" 
                      : "bg-slate-50/50 dark:bg-slate-950/30 border-slate-150/60 dark:border-slate-800/80 text-slate-600 dark:text-slate-400 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 hover:border-slate-200 dark:hover:border-slate-700"
                  }`}
                >
                  {sub}
                </button>
              );
            })}
          </div>
        )}

        {/* Right Panel: Selected Subject Notes */}
        <div className="flex flex-col gap-5" id="notes-right-content-panel">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              {subject} Chapters ({filteredNotes.length})
            </span>

            {/* Search Input */}
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search subject, chapter..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-7 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Admin Upload New Chapter Form */}
          {isAdmin && (
            isAdding ? (
              <form 
                onSubmit={handleSubmit}
                className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-md flex flex-col gap-4 animate-fadeIn"
                id="add-note-form"
              >
                <div className="flex justify-between items-center pb-2 border-b border-slate-50 dark:border-slate-850">
                  <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm">
                    Upload Chapter PDF ({subject})
                  </h3>
                </div>

                {/* Chapter Number & Chapter Name */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Chapter Number
                    </label>
                    <input
                      type="number"
                      min="1"
                      placeholder="e.g. 2"
                      value={chapterNo}
                      onChange={(e) => setChapterNo(e.target.value === "" ? "" : Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-250 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 text-xs font-semibold focus:outline-hidden"
                      required
                    />
                  </div>

                  <div className="sm:col-span-2 flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Chapter Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Indian Culture (Part 1)"
                      value={chapterName}
                      onChange={(e) => setChapterName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-250 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 text-xs font-semibold focus:outline-hidden"
                      required
                    />
                  </div>
                </div>

                {/* PDF File Picker */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    PDF Document
                  </label>
                  <input 
                    type="file"
                    ref={fileInputRef}
                    onChange={handlePdfUploadChange}
                    accept="application/pdf"
                    className="hidden"
                  />
                  
                  {pdfFile ? (
                    <div className="flex items-center justify-between p-3.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-150 rounded-xl text-emerald-800 dark:text-emerald-300">
                      <div className="flex items-center gap-2.5 truncate">
                        <FileText className="w-5 h-5 text-emerald-600 shrink-0" />
                        <span className="text-xs font-bold truncate">{pdfName}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setPdfFile(null); setPdfName(""); }}
                        className="p-1 hover:bg-emerald-100 rounded-lg text-emerald-600 cursor-pointer"
                        disabled={isUploading}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-6 border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-blue-500 rounded-xl flex flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400 font-bold text-xs transition-all cursor-pointer group"
                      disabled={isUploading}
                    >
                      <Upload className="w-5 h-5 text-slate-400 group-hover:text-blue-500 transition-colors" />
                      <span>Upload Chapter PDF File</span>
                      <span className="text-[9px] font-normal text-slate-400">PDF document up to 50MB</span>
                    </button>
                  )}
                </div>

                {error && (
                  <p className="text-xs font-bold text-rose-600 dark:text-rose-400">
                    {error}
                  </p>
                )}

                {isUploading && (
                  <div className="w-full flex flex-col gap-1 mt-1 animate-fadeIn">
                    <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      <span>Uploading PDF...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-600 transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Form Buttons */}
                <div className="flex gap-2 justify-end pt-1 border-t border-slate-50 dark:border-slate-850 mt-1">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 rounded-xl border border-slate-200 transition-all disabled:opacity-50"
                    disabled={isUploading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 text-xs font-extrabold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md cursor-pointer transition-all disabled:bg-blue-400 disabled:cursor-not-allowed flex items-center gap-1.5"
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <>
                        <span className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
                        <span>Uploading… {uploadProgress}%</span>
                      </>
                    ) : (
                      <span>Save & Upload Chapter</span>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setIsAdding(true)}
                className="w-full py-3.5 border-2 border-dashed border-blue-200 dark:border-blue-900/50 hover:border-blue-500 hover:bg-blue-50/20 dark:hover:bg-blue-950/10 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center gap-2 font-extrabold text-xs sm:text-sm transition-all duration-200 cursor-pointer"
                id="btn-add-chapter-notes"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span>Upload New Chapter PDF</span>
              </button>
            )
          )}

          {/* Chapters List */}
          <div className="flex flex-col gap-3.5 mt-1 animate-fadeIn" id="notes-list-container">
            {error && !isAdding && (
              <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-150/40 rounded-xl text-rose-800 dark:text-rose-300 text-xs font-bold flex items-center justify-between gap-2">
                <span>{error}</span>
                <button type="button" onClick={() => setError("")} className="text-rose-400 hover:text-rose-600 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {groupedChapterNotes.length > 0 ? (
              groupedChapterNotes.map((group) => {
                if (group.notes.length === 1) {
                  const note = group.notes[0];
                  return (
                    <div
                      key={note.id}
                      onClick={() => handlePreviewPdf(note)}
                      className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs flex items-center justify-between gap-3 hover:border-blue-300 dark:hover:border-blue-800 transition-all cursor-pointer group"
                      id={`note-card-${note.id}`}
                    >
                      {/* Chapter details */}
                      <div className="flex items-center gap-3.5 truncate min-w-0">
                        <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-xl shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col truncate min-w-0">
                          <h3 className="font-extrabold text-slate-850 dark:text-slate-100 text-sm truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                            Chapter {group.chapterNo} - {group.chapterName}
                          </h3>
                          <div className="flex flex-wrap items-center gap-2 mt-0.5">
                            <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 truncate">
                              {note.pdfFileName || "document_notes.pdf"}
                            </span>
                            {note.createdAt && (
                              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                • {formatDate(note.createdAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Admin/User Action buttons */}
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {/* View Action */}
                        <button
                          type="button"
                          onClick={() => handlePreviewPdf(note)}
                          className="p-2 bg-slate-50 hover:bg-blue-50 text-slate-500 hover:text-blue-600 dark:bg-slate-800 dark:hover:bg-blue-950/40 dark:text-slate-300 dark:hover:text-blue-400 rounded-xl transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                          title="View PDF"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {/* Edit Action */}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNote(note);
                              setEditChapterNo(note.chapterNo);
                              setEditChapterName(note.chapterName);
                              setEditError("");
                            }}
                            className="p-2 bg-slate-50 hover:bg-amber-50 text-slate-500 hover:text-amber-600 dark:bg-slate-800 dark:hover:bg-amber-950/40 dark:text-slate-300 dark:hover:text-amber-400 rounded-xl transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                            title="Edit Chapter Number & Name"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}

                        {/* Delete Action */}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => setDeleteModalNoteId(note.id)}
                            className="p-2 bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/40 dark:text-slate-300 dark:hover:text-rose-400 rounded-xl transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                            title="Delete Chapter PDF"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }

                // Multiple PDFs in this Chapter
                return (
                  <div
                    key={`chapter-group-${group.chapterNo}`}
                    className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs flex flex-col gap-3"
                    id={`chapter-group-${group.chapterNo}`}
                  >
                    {/* Group Header */}
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-xl">
                          <BookOpen className="w-4 h-4" />
                        </div>
                        <h3 className="font-extrabold text-slate-850 dark:text-slate-100 text-sm">
                          Chapter {group.chapterNo} - {group.chapterName}
                        </h3>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                        {group.notes.length} PDFs
                      </span>
                    </div>

                    {/* PDF List */}
                    <div className="flex flex-col gap-2">
                      {group.notes.map((note) => (
                        <div
                          key={note.id}
                          onClick={() => handlePreviewPdf(note)}
                          className="p-3 bg-slate-50/60 dark:bg-slate-950/40 rounded-xl border border-slate-150/60 dark:border-slate-800/80 flex items-center justify-between gap-3 hover:border-blue-300 dark:hover:border-blue-800 hover:bg-blue-50/20 dark:hover:bg-blue-950/20 transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                {note.pdfFileName || note.chapterName}
                              </span>
                              {note.createdAt && (
                                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                  {formatDate(note.createdAt)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => handlePreviewPdf(note)}
                              className="p-1.5 bg-white dark:bg-slate-800 hover:bg-blue-50 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                              title="View PDF"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingNote(note);
                                  setEditChapterNo(note.chapterNo);
                                  setEditChapterName(note.chapterName);
                                  setEditError("");
                                }}
                                className="p-1.5 bg-white dark:bg-slate-800 hover:bg-amber-50 text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 rounded-lg transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                                title="Edit Chapter"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => setDeleteModalNoteId(note.id)}
                                className="p-1.5 bg-white dark:bg-slate-800 hover:bg-rose-50 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg transition-all border border-slate-200 dark:border-slate-700 cursor-pointer"
                                title="Delete PDF"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              <div 
                className="flex flex-col items-center justify-center py-16 text-center px-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900/50"
                id="empty-notes-placeholder"
              >
                <div className="p-3.5 bg-slate-50 dark:bg-slate-950 text-slate-400 rounded-2xl mb-3">
                  <BookOpen className="w-8 h-8 stroke-[1.2]" />
                </div>
                <h3 className="text-slate-800 dark:text-slate-200 font-bold text-sm">
                  {searchQuery ? "No matching chapters found." : `No PDFs uploaded for ${subject}.`}
                </h3>
                <p className="text-slate-400 text-xs mt-1 max-w-xs leading-relaxed">
                  {searchQuery ? "Try searching with a different term." : "Upload chapter PDFs to make them available for students."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- EDIT CHAPTER MODAL --- */}
      {editingNote && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 max-w-md w-full shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-2">
                <Pencil className="w-4 h-4 text-blue-600" />
                <span>Edit Chapter Details</span>
              </h3>
              <button
                onClick={() => setEditingNote(null)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!editChapterNo || Number(editChapterNo) <= 0) {
                  setEditError("Please enter a valid chapter number");
                  return;
                }
                if (!editChapterName.trim()) {
                  setEditError("Please enter a chapter name");
                  return;
                }
                try {
                  setIsEditingSaving(true);
                  setEditError("");
                  if (onEditNote) {
                    await onEditNote(editingNote.id, Number(editChapterNo), editChapterName.trim());
                  }
                  setEditingNote(null);
                } catch (err: any) {
                  setEditError(err.message || "Failed to update chapter");
                } finally {
                  setIsEditingSaving(false);
                }
              }}
              className="flex flex-col gap-3.5"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Chapter Number
                </label>
                <input
                  type="number"
                  min="1"
                  value={editChapterNo}
                  onChange={(e) => setEditChapterNo(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 text-xs font-semibold focus:outline-hidden"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Chapter Name
                </label>
                <input
                  type="text"
                  value={editChapterName}
                  onChange={(e) => setEditChapterName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 text-xs font-semibold focus:outline-hidden"
                  required
                />
              </div>

              {editError && (
                <p className="text-xs font-bold text-rose-600 dark:text-rose-400">{editError}</p>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingNote(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition cursor-pointer"
                  disabled={isEditingSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-extrabold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  disabled={isEditingSaving}
                >
                  {isEditingSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- NATIVE PDF LAUNCHER MODAL --- */}
      {activePreviewPdf && (
        <PdfViewer
          url={activePreviewPdf.url}
          title={activePreviewPdf.title}
          onClose={() => setActivePreviewPdf(null)}
          noteId={activePreviewPdf.noteId}
          storagePath={activePreviewPdf.storagePath}
          bucket={activePreviewPdf.bucket}
        />
      )}

      {/* --- CONFIRM DELETE MODAL --- */}
      <ConfirmDeleteModal
        isOpen={!!deleteModalNoteId}
        isDeleting={isDeleting}
        onCancel={() => {
          if (!isDeleting) setDeleteModalNoteId(null);
        }}
        onConfirm={async () => {
          if (!deleteModalNoteId) return;
          try {
            setIsDeleting(true);
            setError("");
            await onDeleteNote(deleteModalNoteId);
            setDeleteModalNoteId(null);
          } catch (err: any) {
            setError(err.message || "Failed to delete PDF note");
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </div>
  );
}
