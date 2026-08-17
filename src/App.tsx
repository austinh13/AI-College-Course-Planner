import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CometFlyby,
  ScheduleGridBackdrop,
  StepIndicator,
} from "./components/AppShellDecorations";
import QuestionnaireStep from "./steps/QuestionnaireStep";
import TimeConstraintsStep from "./steps/TimeConstraintsStep";
import AcademicHistory from "./components/AcademicHistory";
import ReviewStep from "./steps/ReviewStep";
import ScheduleStep from "./steps/ScheduleStep";
import { wakeBackend } from "./lib/api";
import "./App.css";
import type { AcademicHistory as AcademicHistoryState, Constraints, Profile, ScheduleCourse, Stage } from "./types";

const STAGE = { PROFILE: 0, CONSTRAINTS: 1, ACADEMIC_HISTORY: 2, REVIEW: 3, SCHEDULE: 4 } as const;

const initialProfile: Profile = { major: "", year: "", isHonors: false };
const initialConstraints: Constraints = {
  daysOff: [],
  timeBlocks: [],
  wantsLunch: false,
  lunchStart: "12:00",
  lunchEnd: "13:00",
  targetHours: "",
  maxHoursPerDay: "",
  unlimitedDailyHours: false,
  gradeImportance: 1,
  rmpImportance: 1,
};
const initialAcademicHistory: AcademicHistoryState = {
  completed: new Set<string>(),
  manualEntries: {},
  completedCodes: [],
  hoursEarned: 0,
  hoursLeft: null,
  totalHours: null,
};

export default function App() {
  const [stage, setStage] = useState<Stage>(STAGE.PROFILE);
  const [furthestStage, setFurthestStage] = useState<Stage>(STAGE.PROFILE);
  const [profile, setProfile] = useState(initialProfile);
  const [constraints, setConstraints] = useState(initialConstraints);
  const [academicHistory, setAcademicHistory] = useState(initialAcademicHistory);
  const [scheduleCourses, setScheduleCourses] = useState<ScheduleCourse[]>([]);

  useEffect(() => {
    wakeBackend();
  }, []);

  function advanceTo(next: Stage) {
    setStage(next);
    setFurthestStage((prev) => Math.max(prev, next) as Stage);
  }

  function handleNavigate(target: Stage) {
    if (target <= furthestStage) setStage(target);
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#081712] text-[#f2f5f3]">
      {stage <= STAGE.CONSTRAINTS && <ScheduleGridBackdrop />}
      {stage === STAGE.PROFILE && <CometFlyby />}

      <header className="relative z-10 flex items-center justify-between gap-6 px-[clamp(20px,5vw,64px)] pt-7">
        <span
          className="text-[1.1rem] font-bold tracking-[-0.01em] text-[#f2f5f3]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Comet Planner
        </span>
        <StepIndicator current={stage} furthest={furthestStage} onNavigate={handleNavigate} />
      </header>

      <main className="relative z-10 flex flex-1 min-h-0 items-center justify-center px-[clamp(20px,5vw,64px)] pb-[clamp(32px,8vw,64px)] pt-[clamp(24px,6vw,40px)]">
        <AnimatePresence mode="wait">
          <motion.div
            key={stage}
            className={stage === STAGE.ACADEMIC_HISTORY ? "h-full min-h-0 w-full" : undefined}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {stage === STAGE.PROFILE && (
              <QuestionnaireStep
                data={profile}
                onChange={setProfile}
                onNext={() => advanceTo(STAGE.CONSTRAINTS)}
              />
            )}

            {stage === STAGE.CONSTRAINTS && (
              <TimeConstraintsStep
                data={constraints}
                onChange={setConstraints}
                onBack={() => setStage(STAGE.PROFILE)}
                onSubmit={() => advanceTo(STAGE.ACADEMIC_HISTORY)}
              />
            )}

            {stage === STAGE.ACADEMIC_HISTORY && (
              <AcademicHistory
                major={profile.major}
                startYear={profile.year}
                completed={academicHistory.completed}
                manualEntries={academicHistory.manualEntries}
                onChange={(next) => setAcademicHistory((prev) => ({ ...prev, ...next }))}
                onBack={() => setStage(STAGE.CONSTRAINTS)}
                onContinue={(summary) => {
                  setAcademicHistory((prev) => ({ ...prev, ...summary }));
                  advanceTo(STAGE.REVIEW);
                }}
              />
            )}

            {stage === STAGE.REVIEW && (
              <ReviewStep
                profile={profile}
                constraints={constraints}
                academicHistory={academicHistory}
                onEdit={() => setStage(STAGE.ACADEMIC_HISTORY)}
                onContinue={(courses) => {
                  setScheduleCourses(courses);
                  advanceTo(STAGE.SCHEDULE);
                }}
              />
            )}

            {stage === STAGE.SCHEDULE && (
              <ScheduleStep
                courses={scheduleCourses}
                constraints={constraints}
                isHonors={!!profile.isHonors}
                onBack={() => setStage(STAGE.REVIEW)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}



