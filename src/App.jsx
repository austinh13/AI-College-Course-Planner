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

const STAGE = { PROFILE: 0, CONSTRAINTS: 1, ACADEMIC_HISTORY: 2, REVIEW: 3, SCHEDULE: 4 };

const initialProfile = { major: "", year: "", isHonors: false };
const initialConstraints = {
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
const initialAcademicHistory = {
  completed: new Set(),
  manualEntries: {},
  completedCodes: [],
  hoursEarned: 0,
  hoursLeft: null,
  totalHours: null,
};

export default function App() {
  const [stage, setStage] = useState(STAGE.PROFILE);
  // The furthest stage the user has actually reached by completing the
  // one before it. Used to gate the step indicator: you can always jump
  // back to an earlier stage, but can't skip ahead past one you haven't
  // finished yet.
  const [furthestStage, setFurthestStage] = useState(STAGE.PROFILE);
  const [profile, setProfile] = useState(initialProfile);
  const [constraints, setConstraints] = useState(initialConstraints);
  const [academicHistory, setAcademicHistory] = useState(initialAcademicHistory);
  const [scheduleCourses, setScheduleCourses] = useState([]);

  // Fire the moment the app mounts (start of the questionnaire) so a
  // free-tier Render backend has the whole flow to finish waking up.
  useEffect(() => {
    wakeBackend();
  }, []);

  // Advances (or rewinds) to a stage, unlocking it as the new furthest
  // point reached. Used for every "finish this step" transition below.
  function advanceTo(next) {
    setStage(next);
    setFurthestStage((prev) => Math.max(prev, next));
  }

  // Step-indicator navigation: only allowed to a stage already unlocked.
  function handleNavigate(target) {
    if (target <= furthestStage) setStage(target);
  }

  return (
    <div className="app-shell">
      {stage <= STAGE.CONSTRAINTS && <ScheduleGridBackdrop />}
      {stage === STAGE.PROFILE && <CometFlyby />}

      <header className="app-shell__header">
        <span className="app-shell__mark">Comet Planner</span>
        <StepIndicator current={stage} furthest={furthestStage} onNavigate={handleNavigate} />
      </header>

      <main className="app-shell__main">
        <AnimatePresence mode="wait">
          <motion.div
            key={stage}
            className={stage === STAGE.ACADEMIC_HISTORY ? "app-shell__stage--fill" : undefined}
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
