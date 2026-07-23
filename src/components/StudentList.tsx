import React, { useState, useMemo, useEffect } from "react";
import { Search, Edit2, Trash2, Plus, AlertCircle, Phone, Calendar } from "lucide-react";
import { Student } from "../types";
import { getMonthsUpToCurrent } from "../utils/monthHelper";
import StudentAvatar from "./StudentAvatar";

interface StudentListProps {
  students: Student[];
  filter?: "All" | "Pending";
  onFilterChange?: (filter: "All" | "Pending") => void;
  onSelectStudent: (studentId: string) => void;
  onEditStudent: (student: Student) => void;
  onDeleteStudent: (studentId: string) => void;
  onAddStudent: () => void;
}

// Utility to find overdue months
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function isFutureMonth(monthYearStr: string, currentDateTime: Date = new Date()): boolean {
  const [mName, yStr] = monthYearStr.split(" ");
  const mIdx = MONTH_NAMES.indexOf(mName);
  const year = parseInt(yStr);
  if (mIdx === -1 || isNaN(year)) return false;

  const currentYear = currentDateTime.getFullYear();
  const currentMonthIdx = currentDateTime.getMonth();

  if (year > currentYear) return true;
  if (year === currentYear && mIdx > currentMonthIdx) return true;
  return false;
}

export function hasAttendedInMonth(student: Student, monthYearStr: string): boolean {
  const [mName, yStr] = monthYearStr.split(" ");
  const mIdx = MONTH_NAMES.indexOf(mName);
  const year = parseInt(yStr);
  if (mIdx === -1 || isNaN(year)) return false;
  
  const prefix = `${year}-${String(mIdx + 1).padStart(2, "0")}-`;
  const attendanceKeys = Object.keys(student.attendance || {});
  
  const monthKeys = attendanceKeys.filter(key => key.startsWith(prefix));
  if (monthKeys.length === 0) {
    // No attendance logs yet for this month. Default to true so we don't hide pending dues.
    return true;
  }
  
  // Return true if present at least once, or if marked N/A (holiday)
  return monthKeys.some(key => student.attendance[key] === true || student.attendance[key] === "na");
}

export function getUnpaidOverdueMonths(student: Student, currentDateTime: Date = new Date()): string[] {
  // Use student's feeMonthsList or default to months up to current
  const months = student.feeMonthsList && student.feeMonthsList.length > 0
    ? student.feeMonthsList
    : getMonthsUpToCurrent();
  
  // Parse student registration date (default to "2026-06-01" for older/default students)
  const regDate = student.registrationDate || "2026-06-01";
  let regYear = 2026;
  let regMonthIdx = 5;

  if (regDate.includes("/")) {
    const parts = regDate.split("/");
    if (parts.length === 3) {
      regYear = parseInt(parts[2]) || 2026;
      regMonthIdx = (parseInt(parts[1]) || 6) - 1;
    }
  } else {
    const parts = regDate.split("-");
    if (parts.length === 3) {
      regYear = parseInt(parts[0]) || 2026;
      regMonthIdx = (parseInt(parts[1]) || 6) - 1;
    }
  }

  // Fallback defaults for feeMonths
  const feeMonths = student.feeMonths || {
    "June 2026": student.id === "student-3" || student.id === "student-5" ? "unpaid" : "paid",
    "July 2026": student.feePaidThisMonth ? "paid" : "unpaid"
  };

  const unpaidOverdue: string[] = [];

  months.forEach(m => {
    const [mName, yStr] = m.split(" ");
    const mIdx = MONTH_NAMES.indexOf(mName);
    const year = parseInt(yStr) || 2026;

    if (mIdx !== -1 && !isNaN(year)) {
      // 1. Do NOT calculate dues for future months that have not started
      if (isFutureMonth(m, currentDateTime)) {
        return;
      }

      // 2. Check if this month is before student's registration month
      if (year < regYear || (year === regYear && mIdx < regMonthIdx)) {
        return;
      }

      // 3. Only calculate dues for students who are coming based on attendance for that month
      if (!hasAttendedInMonth(student, m)) {
        return;
      }

      const status = feeMonths[m] || "unpaid";
      if (status === "unpaid") {
        unpaidOverdue.push(m);
      }
    }
  });

  return unpaidOverdue;
}

export default function StudentList({
  students,
  filter = "All",
  onFilterChange,
  onSelectStudent,
  onEditStudent,
  onDeleteStudent,
  onAddStudent
}: StudentListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<string>("All");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  // Synchronize filter prop changes (e.g. navigation from Dashboard cards)
  useEffect(() => {
    if (filter) {
      setActiveTab(filter);
    }
  }, [filter]);

  // Compute dynamic class tabs based on current registered student body
  const tabsList = useMemo(() => {
    const classesSet = new Set(students.map(s => s.classGrade));
    const classes = Array.from(classesSet);
    
    // Sort numerically descending e.g. Class 10, Class 9, Class 8
    classes.sort((a, b) => {
      const numA = parseInt(a.replace(/[^0-9]/g, "")) || 0;
      const numB = parseInt(b.replace(/[^0-9]/g, "")) || 0;
      return numB - numA;
    });

    return ["All", ...classes];
  }, [students]);

  // Filter students by search bar query and active segment tab
  const filteredStudents = useMemo(() => {
    return students.filter((student) => {
      // Tab segregation logic
      if (activeTab !== "All" && student.classGrade !== activeTab) {
        return false;
      }
      
      // Search query filter
      const term = searchTerm.trim().toLowerCase();
      if (!term) return true;

      const termDigits = term.replace(/[^0-9]/g, "");
      const classDigits = student.classGrade.replace(/[^0-9]/g, "");

      const matchesClass = 
        student.classGrade.toLowerCase().includes(term) ||
        (termDigits.length > 0 && classDigits === termDigits) ||
        (termDigits.length > 0 && student.classGrade.toLowerCase().includes(`class ${termDigits}`)) ||
        (termDigits.length > 0 && student.classGrade.toLowerCase().includes(`grade ${termDigits}`));

      return (
        student.name.toLowerCase().includes(term) ||
        student.phone.toLowerCase().includes(term) ||
        matchesClass
      );
    });
  }, [students, searchTerm, activeTab]);

  // Helper to extract name initials
  const getInitials = (name: string) => {
    if (!name) return "?";
    const parts = name.split(" ");
    if (parts.length > 1) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
  };

  const handleTabClick = (tab: string) => {
    setActiveTab(tab);
    if (onFilterChange) {
      onFilterChange("All");
    }
  };

  return (
    <div className="flex flex-col gap-5 pb-24 relative min-h-[500px] animate-fadeIn" id="students-view">
      {/* Title */}
      <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-800 dark:text-slate-100 mt-0.5" id="students-title">
          STUDENT DIRECTORY
        </h1>
      </div>

      {/* Search Input */}
      <div className="relative" id="search-container">
        <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
          <Search className="w-4 h-4" />
        </span>
        <input
          type="text"
          placeholder="Search by name, phone, or class..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 text-sm font-semibold transition-all"
          id="student-search-input"
        />
      </div>

      {/* Segmented Tabs (Horizontal Scroll on narrow devices) */}
      <div className="flex border-b border-slate-100 dark:border-slate-800 overflow-x-auto scrollbar-none gap-1 mt-1 -mx-4 px-4 sm:mx-0 sm:px-0" id="class-tabs-container">
        {tabsList.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => handleTabClick(tab)}
              className={`py-2.5 px-4 text-xs font-extrabold uppercase tracking-wider border-b-2 whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? "border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
              id={`tab-${tab.replace(" ", "-")}`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Student List Grid */}
      <div className="flex flex-col gap-3" id="student-list-container">
        {filteredStudents.length > 0 ? (
          filteredStudents.map((student) => {
            const initials = getInitials(student.name);
            const overdueMonths = getUnpaidOverdueMonths(student);
            const isPending = overdueMonths.length > 0;

            return (
              <div
                key={student.id}
                onClick={() => onSelectStudent(student.id)}
                className={`flex items-center justify-between p-4 bg-white dark:bg-slate-900 rounded-2xl border transition-all hover:scale-[1.01] hover:shadow-md cursor-pointer group ${
                  isPending 
                    ? "border-rose-100 dark:border-rose-950 bg-gradient-to-r from-white to-rose-50/10 dark:from-slate-900 dark:to-rose-950/5" 
                    : "border-slate-100 dark:border-slate-800"
                }`}
                id={`student-row-${student.id}`}
              >
                {/* Left side: Avatar & info */}
                <div className="flex items-center gap-3.5">
                  {/* Photo or initials fallback */}
                  <div className="relative shrink-0">
                    <StudentAvatar
                      student={student}
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border border-slate-200 dark:border-slate-700/80 shadow-xs"
                      initialsClassName="text-base sm:text-lg font-black"
                      id={`student-avatar-${student.id}`}
                    />
                    {/* Tiny visual exclamation indicator if payment is overdue */}
                    {isPending && (
                      <span className="absolute -top-0.5 -right-0.5 bg-rose-600 text-white p-0.5 rounded-full border-2 border-white dark:border-slate-900 z-10 shadow-xs">
                        <AlertCircle className="w-3 h-3 stroke-[3]" />
                      </span>
                    )}
                  </div>

                  {/* Info details */}
                  <div className="flex flex-col">
                    <span className="font-bold text-slate-800 dark:text-slate-100 text-sm sm:text-base group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {student.name}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 text-[10px] sm:text-xs font-semibold text-slate-400 dark:text-slate-500">
                      <span>{student.classGrade}</span>
                      <span>•</span>
                      <span>₹{student.monthlyFee}/mo</span>
                    </div>

                    {/* Pending billing banner warning */}
                    {isPending && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                        <Calendar className="w-3 h-3" />
                        <span>Pending: {overdueMonths.join(", ")}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right side: Action Buttons */}
                <div 
                  className="flex items-center gap-2" 
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Edit button */}
                  <button
                    onClick={() => onEditStudent(student)}
                    className="p-2 bg-slate-50 hover:bg-blue-50 text-slate-400 hover:text-blue-600 dark:bg-slate-800 dark:hover:bg-blue-950/30 dark:hover:text-blue-400 rounded-xl transition-all border border-slate-100 dark:border-slate-800 cursor-pointer"
                    id={`btn-edit-${student.id}`}
                    title="Edit Student"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  {/* Delete button with double-tap iframe-proof confirm state */}
                  {confirmDeleteId === student.id ? (
                    <div className="flex items-center gap-1.5 animate-fadeIn">
                      <button
                        onClick={() => {
                          onDeleteStudent(student.id);
                          setConfirmDeleteId(null);
                        }}
                        className="py-1.5 px-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                        title="Confirm deletion"
                      >
                        Confirm Delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="py-1.5 px-2 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(student.id)}
                      className="p-2 bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/20 dark:hover:text-rose-400 rounded-xl transition-all border border-slate-100 dark:border-slate-800 cursor-pointer"
                      id={`btn-delete-${student.id}`}
                      title="Delete Student"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900/50" id="no-students-placeholder">
            <AlertCircle className="w-8 h-8 text-slate-300 dark:text-slate-700 mb-2" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No students found</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Try adjusting your search query or filters.</p>
          </div>
        )}
      </div>

      {/* Floating Action Button (FAB) */}
      <button
        onClick={onAddStudent}
        className="fixed bottom-20 right-6 sm:bottom-24 w-12 h-12 sm:w-14 sm:h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center shadow-lg shadow-blue-500/20 border border-blue-500/10 hover:scale-105 active:scale-95 transition-all cursor-pointer z-20"
        id="btn-add-student-fab"
        title="Add New Student"
      >
        <Plus className="w-5 h-5 sm:w-6 sm:h-6 stroke-[3]" />
      </button>
    </div>
  );
}
