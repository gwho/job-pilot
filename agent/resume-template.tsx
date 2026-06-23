import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

import type { Profile } from "@/types/index";

export interface ResumeContent {
  summary: string;
  workExperience: Array<{
    company: string;
    title: string;
    period: string;
    bullets: string[];
  }>;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1a1a1a",
    lineHeight: 1.3,
  },
  name: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 3,
  },
  currentTitle: {
    fontSize: 11,
    color: "#555555",
    marginBottom: 8,
  },
  divider: {
    height: 1,
    backgroundColor: "#dddddd",
    marginBottom: 6,
  },
  contactLine: {
    fontSize: 9,
    color: "#666666",
    marginBottom: 3,
  },
  sectionLabel: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#888888",
    marginTop: 12,
    marginBottom: 3,
  },
  sectionRule: {
    height: 0.5,
    backgroundColor: "#cccccc",
    marginBottom: 5,
  },
  summaryText: {
    fontSize: 10,
    lineHeight: 1.5,
    color: "#333333",
  },
  skillsText: {
    fontSize: 10,
    color: "#333333",
  },
  jobBlock: {
    marginBottom: 8,
  },
  jobHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 1,
  },
  companyName: {
    fontWeight: "bold",
    fontSize: 10,
  },
  period: {
    fontSize: 9,
    color: "#888888",
  },
  jobTitle: {
    fontSize: 10,
    color: "#555555",
    marginBottom: 3,
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: 2,
    paddingLeft: 4,
  },
  bulletDot: {
    width: 12,
    fontSize: 10,
    color: "#555555",
  },
  bulletText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 1.4,
    color: "#333333",
  },
  eduHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 1,
  },
  eduDegree: {
    fontWeight: "bold",
    fontSize: 10,
  },
  eduYear: {
    fontSize: 9,
    color: "#888888",
  },
  eduInstitution: {
    fontSize: 9,
    color: "#555555",
  },
});

interface Props {
  profile: Profile;
  content: ResumeContent;
}

export function ResumeDocument({ profile, content }: Props) {
  const contactLine = [profile.email, profile.phone, profile.location]
    .filter(Boolean)
    .join("  ·  ");

  const linksLine = [profile.linkedin_url, profile.portfolio_url]
    .filter(Boolean)
    .join("  ·  ");

  const educationLabel =
    profile.education
      ? [profile.education.degree, profile.education.fieldOfStudy]
          .filter(Boolean)
          .join(" in ")
      : null;

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <Text style={styles.name}>{profile.full_name ?? ""}</Text>
        {profile.current_title ? (
          <Text style={styles.currentTitle}>{profile.current_title}</Text>
        ) : null}
        <View style={styles.divider} />
        {contactLine ? (
          <Text style={styles.contactLine}>{contactLine}</Text>
        ) : null}
        {linksLine ? (
          <Text style={{ ...styles.contactLine, marginBottom: 8 }}>
            {linksLine}
          </Text>
        ) : null}

        {/* Summary */}
        {content.summary ? (
          <>
            <Text style={styles.sectionLabel}>SUMMARY</Text>
            <View style={styles.sectionRule} />
            <Text style={styles.summaryText}>{content.summary}</Text>
          </>
        ) : null}

        {/* Skills */}
        {profile.skills && profile.skills.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>SKILLS</Text>
            <View style={styles.sectionRule} />
            <Text style={styles.skillsText}>
              {profile.skills.join(" • ")}
            </Text>
          </>
        ) : null}

        {/* Work Experience */}
        {content.workExperience && content.workExperience.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>EXPERIENCE</Text>
            <View style={styles.sectionRule} />
            {content.workExperience.map((job, i) => (
              <View key={i} style={styles.jobBlock}>
                <View style={styles.jobHeaderRow}>
                  <Text style={styles.companyName}>{job.company}</Text>
                  <Text style={styles.period}>{job.period}</Text>
                </View>
                <Text style={styles.jobTitle}>{job.title}</Text>
                {job.bullets.map((bullet, j) => (
                  <View key={j} style={styles.bulletRow}>
                    <Text style={styles.bulletDot}>•</Text>
                    <Text style={styles.bulletText}>{bullet}</Text>
                  </View>
                ))}
              </View>
            ))}
          </>
        ) : null}

        {/* Education */}
        {profile.education && educationLabel ? (
          <>
            <Text style={styles.sectionLabel}>EDUCATION</Text>
            <View style={styles.sectionRule} />
            <View style={styles.eduHeaderRow}>
              <Text style={styles.eduDegree}>{educationLabel}</Text>
              {profile.education.graduationYear ? (
                <Text style={styles.eduYear}>
                  {profile.education.graduationYear}
                </Text>
              ) : null}
            </View>
            {profile.education.institution ? (
              <Text style={styles.eduInstitution}>
                {profile.education.institution}
              </Text>
            ) : null}
          </>
        ) : null}
      </Page>
    </Document>
  );
}
