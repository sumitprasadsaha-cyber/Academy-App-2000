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
  Sparkles,
  Download
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
  // Adjusted to handle new PDF payload properties
  onAddNote: (chapterNo: number, chapterName: string, pdfUrl: string, pdfFileName: string) => void;
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

  // Rearrange order of uploaded chapter by chapter number
  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => {
      return (a.chapterNo || 0) - (b.chapterNo || 0);
    });
  }, [notes]);

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
      title: `Chapter ${note.chapterNo}: ${note.chapterName}`,
      noteId: note.id,
      storagePath: storagePath || url,
      bucket: bucket
    });
  };

  const [downloadingNoteId, setDownloadingNoteId] = useState<string | null>(null);

  const handleDownloadPdf = async (note: ChapterNote) => {
    if (!note.pdfUrl || downloadingNoteId) return;
    try {
      setDownloadingNoteId(note.id);
      const bucket = getBucketName(note.bucket);
      const storagePath = sanitizeStoragePath(note.storagePath || note.pdfUrl, bucket);
      const fileName = note.pdfFileName || note.fileName || `Chapter_${note.chapterNo}_Notes.pdf`;
      
      console.log(`[SubjectNotes] Downloading note: bucket="${bucket}", path="${storagePath}"`);
      await downloadFileFromStorage(bucket, storagePath, fileName);
    } catch (err: any) {
      console.error("[SubjectNotes] Download failed:", err);
      setError(`Failed to download PDF: ${err.message || err}`);
    } finally {
      setDownloadingNoteId(null);
    }
  };
  const handlePdfUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== "application/pdf") {
        setError("Only PDF document files are supported.");
        return;
      }
      // Check for 50MB limit (50 * 1024 * 1024 bytes)
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

      // Clear and reset form
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
          title="Back to student profile"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider">
            {studentName} - Study & Revision Hub
          </span>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 -mt-0.5">
            Chapter wise Notes
          </h1>
        </div>
      </div>

      {/* Two-Panel Responsive Grid */}
      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6 items-start" id="notes-two-panel-container">
        
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
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              {subject} CHAPTERS
            </span>
          </div>

          {/* Upload New PDF Form */}
          {isAdmin && (
        isAdding ? (
          <form 
            onSubmit={handleSubmit}
            className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-md flex flex-col gap-4 animate-fadeIn"
            id="add-note-form"
          >
            <div className="flex justify-between items-center pb-2 border-b border-slate-50 dark:border-slate-850">
              <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm">
                Upload Chapter Note PDF
              </h3>
            </div>

            {/* Row: Chapter No. & Chapter Name */}
            <div className="grid grid-cols-3 gap-3.5">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Chapter No.
                </label>
                <input
                  type="number"
                  min="1"
                  placeholder="e.g. 5"
                  value={chapterNo}
                  onChange={(e) => setChapterNo(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-250 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 text-xs font-semibold focus:outline-hidden"
                  required
                />
              </div>

              <div className="col-span-2 flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Chapter Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Trigonometric Equations"
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
                PDF Notes Document
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
                  <span>Upload PDF Document</span>
                  <span className="text-[9px] font-normal text-slate-400">File size should be under 50MB</span>
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
                  <span>Uploading files directly to Storage...</span>
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

            {/* Action buttons */}
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
                  <span>Upload Chapter Note</span>
                )}
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full py-4 border-2 border-dashed border-blue-200 dark:border-blue-900/50 hover:border-blue-500 hover:bg-blue-50/20 dark:hover:bg-blue-950/10 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center gap-2 font-extrabold text-sm transition-all duration-200 cursor-pointer"
            id="btn-add-chapter-notes"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Upload New Chapter PDF</span>
          </button>
        )
      )}

      {/* Chapters Sorted alphabetically */}
      <div className="flex flex-col gap-3.5 mt-1 animate-fadeIn" id="notes-list-container">
        {error && !isAdding && (
          <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-150/40 rounded-xl text-rose-800 dark:text-rose-300 text-xs font-bold flex items-center justify-between gap-2">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} className="text-rose-400 hover:text-rose-600 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {sortedNotes.length > 0 ? (
          sortedNotes.map((note) => {
            return (
              <div
                key={note.id}
                className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center justify-between gap-3"
                id={`note-card-${note.id}`}
              >
                {/* PDF details and Title */}
                <div className="flex items-center gap-3.5 truncate">
                  <div className="p-2.5 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-xl shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex flex-col truncate">
                    <h3 className="font-extrabold text-slate-850 dark:text-slate-100 text-sm truncate">
                      Chapter {note.chapterNo}
                    </h3>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {note.chapterName}
                    </p>
                    {note.createdAt && (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block mt-0.5">
                        Added on {formatDate(note.createdAt)}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-1">
                      {note.pdfFileName || "document_notes.pdf"}
                    </span>
                  </div>
                </div>

                {/* File Action utilities */}
                <div className="flex items-center gap-2">
                  {/* View PDF Preview */}
                  <button
                    type="button"
                    onClick={() => handlePreviewPdf(note)}
                    className="p-2 bg-slate-50 hover:bg-blue-50 text-slate-400 hover:text-blue-600 dark:bg-slate-800 dark:hover:bg-blue-950/30 rounded-xl transition-all border border-slate-100 dark:border-slate-800 cursor-pointer"
                    title="View PDF"
                  >
                    <Eye className="w-4 h-4" />
                  </button>

                  {/* Download PDF */}
                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(note)}
                    disabled={downloadingNoteId === note.id}
                    className="p-2 bg-slate-50 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 dark:bg-slate-800 dark:hover:bg-emerald-950/30 rounded-xl transition-all border border-slate-100 dark:border-slate-800 cursor-pointer disabled:opacity-50"
                    title="Download PDF"
                  >
                    <Download className="w-4 h-4" />
                  </button>

                  {/* Delete note */}
                  {isAdmin && (
                    <button
                      onClick={() => setDeleteModalNoteId(note.id)}
                      className="p-2 bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/20 rounded-xl transition-all border border-slate-100 dark:border-slate-800 cursor-pointer"
                      title="Delete PDF"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div 
            className="flex flex-col items-center justify-center py-20 text-center px-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900/50"
            id="empty-notes-placeholder"
          >
            <div className="p-3.5 bg-slate-50 dark:bg-slate-950 text-slate-400 rounded-2xl mb-3">
              <BookOpen className="w-8 h-8 stroke-[1.2]" />
            </div>
            <h3 className="text-slate-800 dark:text-slate-200 font-bold text-sm">
              No PDFs uploaded for {subject}.
            </h3>
            <p className="text-slate-400 text-xs mt-1 max-w-xs leading-relaxed">
              Upload study guides or key chapter summary documents in PDF format for this student.
            </p>
          </div>
        )}
      </div>
    </div>
    </div>

      {/* --- IN-APP PDF PREVIEW DRAWER MODAL --- */}
      {activePreviewPdf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm animate-fadeIn" id="pdf-preview-modal" onClick={() => setActivePreviewPdf(null)}>
          <div className="relative w-full h-full sm:h-[90vh] max-w-4xl bg-white dark:bg-slate-950 rounded-none sm:rounded-2xl p-0 shadow-2xl z-10 flex flex-col overflow-hidden border border-slate-100 dark:border-slate-900" onClick={(e) => e.stopPropagation()}>
            <PdfViewer
              url={activePreviewPdf.url}
              title={activePreviewPdf.title}
              onClose={() => setActivePreviewPdf(null)}
              noteId={activePreviewPdf.noteId}
              storagePath={activePreviewPdf.storagePath}
              bucket={activePreviewPdf.bucket}
            />
          </div>
        </div>
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
