export async function encodeReport(markdown: string, format: "pdf" | "docx"): Promise<Blob> {
  if (format === "pdf") {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    pdf.setFont("helvetica"); pdf.setFontSize(10);
    let y = 42;
    for (const paragraph of markdown.split("\n")) {
      const lines = pdf.splitTextToSize(paragraph.replace(/^#{1,6}\s+/, ""), 510) as string[];
      for (const line of lines) {
        if (y > 795) { pdf.addPage(); y = 42; }
        pdf.text(line, 42, y); y += 14;
      }
    }
    return pdf.output("blob");
  }
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const children = markdown.split("\n").map(line => {
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    return new Paragraph({ children: [new TextRun(heading ? heading[2] : line)], heading: heading ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][heading[1].length - 1] : undefined });
  });
  return Packer.toBlob(new Document({ sections: [{ children }] }));
}
