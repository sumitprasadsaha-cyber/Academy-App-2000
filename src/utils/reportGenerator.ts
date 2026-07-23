import { jsPDF } from "jspdf";
import { Student } from "../types";
import { isFutureMonth, hasAttendedInMonth } from "../components/StudentList";
import { saveAndOpenGeneratedPdf } from "../lib/nativePdfService";

// Generate a list of the 13 months for a March-to-March session
export function getSessionMonths(startYear: number): string[] {
  const monthNames = [
    "January", "February", "March", "April", "May", "June", 
    "July", "August", "September", "October", "November", "December"
  ];
  const months: string[] = [];
  
  // March to December of startYear
  for (let m = 2; m < 12; m++) {
    months.push(`${monthNames[m]} ${startYear}`);
  }
  // January to March of next year
  for (let m = 0; m <= 2; m++) {
    months.push(`${monthNames[m]} ${startYear + 1}`);
  }
  
  return months;
}

// Check if a specific month is overdue based on current time
// Overdue if unpaid after 3rd of the next month at 1:00 PM
export function isMonthOverdue(monthYearStr: string, currentDateTime: Date = new Date()): boolean {
  const monthNames = [
    "January", "February", "March", "April", "May", "June", 
    "July", "August", "September", "October", "November", "December"
  ];
  const [monthName, yearStr] = monthYearStr.split(" ");
  const monthIndex = monthNames.indexOf(monthName);
  const year = parseInt(yearStr);
  
  if (monthIndex === -1 || isNaN(year)) return false;
  
  let nextMonthIdx = monthIndex + 1;
  let nextMonthYear = year;
  if (nextMonthIdx > 11) {
    nextMonthIdx = 0;
    nextMonthYear = year + 1;
  }
  
  // Deadline is 3rd of next month at 1:00 PM
  const deadline = new Date(nextMonthYear, nextMonthIdx, 3, 13, 0, 0);
  return currentDateTime > deadline;
}

// Formats date string from input type date "YYYY-MM-DD" to "DD/MM/YYYY"
export function formatDisplayDate(dateStr: string | undefined): string {
  if (!dateStr) return "N/A";
  if (dateStr.includes("/")) return dateStr; // already formatted
  
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

interface MonthDetailSummary {
  monthStr: string;
  targetRevenue: number;
  collectedRevenue: number;
  duesAmount: number;
  paidCount: number;
  unpaidCount: number;
  paidStudents: Array<{ name: string; classGrade: string; fee: number }>;
  unpaidStudents: Array<{ name: string; classGrade: string; fee: number; phone: string }>;
}

// Generate the Comprehensive Annual PDF Report (Summary + Full Month-by-Month Reports)
export async function generateAnnualReport(startYear: number, students: Student[]) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const sessionMonths = getSessionMonths(startYear);
  const sessionLabel = `March ${startYear} - March ${startYear + 1}`;
  const instName = localStorage.getItem("tuition_institution_name") || "Ingenious Study Circle";

  let totalSessionRevenue = 0;
  let totalSessionDues = 0;
  let totalSessionTarget = 0;
  let activeStudentCount = 0;

  const monthlySummaries: MonthDetailSummary[] = [];

  sessionMonths.forEach((monthStr) => {
    const [mName, yStr] = monthStr.split(" ");
    const monthNames = [
      "January", "February", "March", "April", "May", "June", 
      "July", "August", "September", "October", "November", "December"
    ];
    const mIdx = monthNames.indexOf(mName);
    const year = parseInt(yStr) || startYear;

    let monthTarget = 0;
    let monthCollected = 0;
    let monthDues = 0;
    const paidList: Array<{ name: string; classGrade: string; fee: number }> = [];
    const unpaidList: Array<{ name: string; classGrade: string; fee: number; phone: string }> = [];

    students.forEach((student) => {
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

      // Check if student was enrolled during this month
      const isBeforeRegistration = year < regYear || (year === regYear && mIdx < regMonthIdx);
      if (!isBeforeRegistration) {
        const studentFee = Number(student?.monthlyFee) || 0;
        const studentName = student?.name || "Student";
        const classGrade = student?.classGrade || "N/A";
        const phone = student?.phone || "N/A";

        monthTarget += studentFee;
        const feeMonths = student.feeMonths || {};
        const status = feeMonths[monthStr];

        if (status === "paid") {
          monthCollected += studentFee;
          paidList.push({ name: studentName, classGrade, fee: studentFee });
        } else if (!isFutureMonth(monthStr) && hasAttendedInMonth(student, monthStr) && (status === "unpaid" || (!status && monthStr !== "na"))) {
          monthDues += studentFee;
          unpaidList.push({ name: studentName, classGrade, fee: studentFee, phone });
        }
      }
    });

    totalSessionTarget += monthTarget;
    totalSessionRevenue += monthCollected;
    totalSessionDues += monthDues;

    monthlySummaries.push({
      monthStr,
      targetRevenue: monthTarget,
      collectedRevenue: monthCollected,
      duesAmount: monthDues,
      paidCount: paidList.length,
      unpaidCount: unpaidList.length,
      paidStudents: paidList,
      unpaidStudents: unpaidList,
    });
  });

  // Count active students enrolled during session
  activeStudentCount = students.filter((student) => {
    const regDate = student.registrationDate || "2026-06-01";
    let regYear = 2026;
    if (regDate.includes("-")) {
      regYear = parseInt(regDate.split("-")[0]) || 2026;
    }
    return regYear <= startYear + 1;
  }).length;

  // --- PDF Styling Constants ---
  const primaryColor = [37, 99, 235]; // Blue 600
  const secondaryColor = [30, 41, 59]; // Slate 800
  const lightBg = [248, 250, 252]; // Slate 50
  const redColor = [220, 38, 38]; // Red 600
  const greenColor = [34, 197, 94]; // Green 500

  let currentPage = 1;

  const drawHeaderAndFooter = (pageTitle: string) => {
    // Top Bar
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(0, 0, 210, 6, "F");

    // Top Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(instName.toUpperCase(), 15, 18);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(pageTitle, 15, 23);
    doc.text(`Generated: ${new Date().toLocaleDateString("en-IN")}`, 150, 18);

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.4);
    doc.line(15, 26, 195, 26);

    // Footer
    const footerY = 285;
    doc.setDrawColor(226, 232, 240);
    doc.line(15, footerY - 4, 195, footerY - 4);

    doc.setFont("times", "italic");
    doc.setFontSize(10);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text("Developed and Designed by Sumit", 15, footerY);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text("— POWERED BY ANDROID —", 15, footerY + 3.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Page ${currentPage}`, 180, footerY);
  };

  const checkAddPage = (currentY: number, neededHeight: number = 15, pageTitle: string = "Annual Financial & Audit Report"): number => {
    if (currentY + neededHeight > 270) {
      doc.addPage();
      currentPage++;
      drawHeaderAndFooter(pageTitle);
      return 32;
    }
    return currentY;
  };

  // ================= PAGE 1: SESSION EXECUTIVE SUMMARY =================
  drawHeaderAndFooter(`Annual Financial Audit & Ledger Report (${sessionLabel})`);

  let y = 34;

  // Session Audit Overview Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text("1. SESSION FINANCIAL SUMMARY & KPIS", 15, y);

  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Audit Session: ${sessionLabel}  |  Active Student Roster: ${activeStudentCount}`, 15, y);

  y += 8;
  // KPI Cards
  const cardW = 56;
  const cardH = 22;

  // Card 1: Collected
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.roundedRect(15, y, cardW, cardH, 3, 3, "F");
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(15, y, cardW, cardH, 3, 3, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("TOTAL REVENUE COLLECTED", 19, y + 6);
  doc.setFontSize(13);
  doc.setTextColor(greenColor[0], greenColor[1], greenColor[2]);
  doc.text(`INR ${totalSessionRevenue.toLocaleString("en-IN")}`, 19, y + 15);

  // Card 2: Dues
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.roundedRect(15 + cardW + 6, y, cardW, cardH, 3, 3, "F");
  doc.setDrawColor(254, 226, 226);
  doc.roundedRect(15 + cardW + 6, y, cardW, cardH, 3, 3, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("TOTAL OUTSTANDING DUES", 19 + cardW + 6, y + 6);
  doc.setFontSize(13);
  doc.setTextColor(redColor[0], redColor[1], redColor[2]);
  doc.text(`INR ${totalSessionDues.toLocaleString("en-IN")}`, 19 + cardW + 6, y + 15);

  // Card 3: Collection Rate
  const efficiency = totalSessionTarget > 0 ? Math.round((totalSessionRevenue / totalSessionTarget) * 100) : 100;
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.roundedRect(15 + (cardW * 2) + 12, y, cardW, cardH, 3, 3, "F");
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(15 + (cardW * 2) + 12, y, cardW, cardH, 3, 3, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("COLLECTION EFFICIENCY", 19 + (cardW * 2) + 12, y + 6);
  doc.setFontSize(13);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(`${efficiency}%`, 19 + (cardW * 2) + 12, y + 15);

  y += cardH + 12;

  // Table: Monthly Overview Breakdown
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text("2. MONTH-BY-MONTH FINANCIAL OVERVIEW TABLE", 15, y);

  y += 6;
  doc.setFillColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.rect(15, y, 180, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text("MONTH", 18, y + 5);
  doc.text("TARGET FEES", 65, y + 5);
  doc.text("COLLECTED", 100, y + 5);
  doc.text("OUTSTANDING DUES", 135, y + 5);
  doc.text("PAID / UNPAID", 170, y + 5);

  y += 7;

  monthlySummaries.forEach((sum, idx) => {
    y = checkAddPage(y, 8, `Session Overview - Page ${currentPage}`);

    if (idx % 2 === 1) {
      doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
      doc.rect(15, y, 180, 7, "F");
    }
    doc.setDrawColor(241, 245, 249);
    doc.line(15, y + 7, 195, y + 7);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(sum.monthStr, 18, y + 5);

    doc.setFont("helvetica", "normal");
    doc.text(`INR ${sum.targetRevenue.toLocaleString("en-IN")}`, 65, y + 5);

    doc.setTextColor(greenColor[0], greenColor[1], greenColor[2]);
    doc.text(`INR ${sum.collectedRevenue.toLocaleString("en-IN")}`, 100, y + 5);

    doc.setTextColor(sum.duesAmount > 0 ? redColor[0] : 100, sum.duesAmount > 0 ? redColor[1] : 116, sum.duesAmount > 0 ? redColor[2] : 139);
    doc.text(`INR ${sum.duesAmount.toLocaleString("en-IN")}`, 135, y + 5);

    doc.setTextColor(51, 65, 85);
    doc.text(`${sum.paidCount} Paid / ${sum.unpaidCount} Due`, 170, y + 5);

    y += 7;
  });

  // ================= PAGES 2+: FULL DETAILED MONTHLY REPORTS =================
  monthlySummaries.forEach((sum) => {
    doc.addPage();
    currentPage++;
    drawHeaderAndFooter(`Detailed Monthly Report: ${sum.monthStr}`);
    y = 32;

    // Month Title Banner
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.roundedRect(15, y, 180, 12, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(`MONTHLY AUDIT REPORT — ${sum.monthStr.toUpperCase()}`, 20, y + 8);

    y += 16;

    // Monthly Metrics Sub-header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text(`Expected Target: INR ${sum.targetRevenue.toLocaleString("en-IN")}`, 15, y);
    doc.setTextColor(greenColor[0], greenColor[1], greenColor[2]);
    doc.text(`Collected: INR ${sum.collectedRevenue.toLocaleString("en-IN")} (${sum.paidCount} Students)`, 80, y);
    doc.setTextColor(sum.duesAmount > 0 ? redColor[0] : 100, sum.duesAmount > 0 ? redColor[1] : 116, sum.duesAmount > 0 ? redColor[2] : 139);
    doc.text(`Dues: INR ${sum.duesAmount.toLocaleString("en-IN")} (${sum.unpaidCount} Students)`, 145, y);

    y += 8;

    // 1. Paid Students List Table
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text(`A. PAID STUDENTS (${sum.paidCount})`, 15, y);

    y += 5;
    doc.setFillColor(34, 197, 94); // Green Header
    doc.rect(15, y, 180, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text("STUDENT NAME", 18, y + 4.2);
    doc.text("CLASS", 100, y + 4.2);
    doc.text("AMOUNT PAID", 150, y + 4.2);

    y += 6;

    if (sum.paidStudents.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text("No fee collections recorded for this month.", 18, y + 5);
      y += 8;
    } else {
      sum.paidStudents.forEach((st, pIdx) => {
        y = checkAddPage(y, 6, `Detailed Monthly Report: ${sum.monthStr}`);

        if (pIdx % 2 === 1) {
          doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
          doc.rect(15, y, 180, 6, "F");
        }
        doc.setDrawColor(241, 245, 249);
        doc.line(15, y + 6, 195, y + 6);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(51, 65, 85);
        doc.text(st.name, 18, y + 4.2);

        doc.setFont("helvetica", "normal");
        doc.text(st.classGrade, 100, y + 4.2);

        doc.setFont("helvetica", "bold");
        doc.setTextColor(greenColor[0], greenColor[1], greenColor[2]);
        doc.text(`INR ${st.fee.toLocaleString("en-IN")}`, 150, y + 4.2);

        y += 6;
      });
    }

    y += 6;

    // 2. Unpaid Students List Table
    y = checkAddPage(y, 15, `Detailed Monthly Report: ${sum.monthStr}`);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    doc.text(`B. OUTSTANDING DUES STUDENTS (${sum.unpaidCount})`, 15, y);

    y += 5;
    doc.setFillColor(redColor[0], redColor[1], redColor[2]); // Red Header
    doc.rect(15, y, 180, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text("STUDENT NAME", 18, y + 4.2);
    doc.text("CLASS", 80, y + 4.2);
    doc.text("CONTACT PHONE", 120, y + 4.2);
    doc.text("AMOUNT DUE", 160, y + 4.2);

    y += 6;

    if (sum.unpaidStudents.length === 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(greenColor[0], greenColor[1], greenColor[2]);
      doc.text("All students are fully paid for this month!", 18, y + 5);
      y += 8;
    } else {
      sum.unpaidStudents.forEach((st, uIdx) => {
        y = checkAddPage(y, 6, `Detailed Monthly Report: ${sum.monthStr}`);

        if (uIdx % 2 === 1) {
          doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
          doc.rect(15, y, 180, 6, "F");
        }
        doc.setDrawColor(241, 245, 249);
        doc.line(15, y + 6, 195, y + 6);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(51, 65, 85);
        doc.text(st.name, 18, y + 4.2);

        doc.setFont("helvetica", "normal");
        doc.text(st.classGrade, 80, y + 4.2);
        doc.text(st.phone, 120, y + 4.2);

        doc.setFont("helvetica", "bold");
        doc.setTextColor(redColor[0], redColor[1], redColor[2]);
        doc.text(`INR ${(st.fee || 0).toLocaleString("en-IN")}`, 160, y + 4.2);

        y += 6;
      });
    }
  });

  // Download PDF file with robust fallback
  const fileName = `Annual_Financial_Audit_${startYear}_${startYear + 1}.pdf`;
  try {
    const pdfBlob = doc.output("blob");
    await saveAndOpenGeneratedPdf(pdfBlob, fileName);
  } catch (error) {
    console.warn("[PDF Generator] Native save failed, using fallback:", error);
    try {
      doc.save(fileName);
    } catch (e) {
      console.error("[PDF Generator] Fallback failed:", e);
      const string = doc.output("datauristring");
      window.open(string, "_blank");
    }
  }
}
