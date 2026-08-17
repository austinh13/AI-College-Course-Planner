export type Stage = 0 | 1 | 2 | 3 | 4;

export interface Profile {
  major: string;
  year: string;
  isHonors: boolean;
}

export interface Constraints {
  daysOff: string[];
  timeBlocks: string[];
  wantsLunch: boolean;
  lunchStart: string;
  lunchEnd: string;
  targetHours: string;
  maxHoursPerDay: string;
  unlimitedDailyHours: boolean;
  gradeImportance: number;
  rmpImportance: number;
}

export interface AcademicHistory {
  completed: Set<string>;
  manualEntries: Record<string, Array<{ code: string; hours: number }>>;
  completedCodes: string[];
  hoursEarned: number;
  hoursLeft: number | null;
  totalHours: number | null;
  degreeType?: string | null;
}

export interface ScheduleCourse {
  code: string;
  section: {
    meetings: Array<{
      day: string;
      start: number;
      end: number;
      kind?: string;
    }>;
  };
}

