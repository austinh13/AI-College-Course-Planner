import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import ScheduleGridBackdrop from "./components/ScheduleGridBackdrop";
import StepIndicator from "./components/StepIndicator";
import QuestionnaireStep from "./steps/QuestionnaireStep";
import TimeConstraintsStep from "./steps/TimeConstraintsStep";
import ReviewStep from "./steps/ReviewStep";
import { wakeBackend } from "./lib/api";
import "./App.css";

const STAGE = { PROFILE: 0, CONSTRAINTS: 1, REVIEW: 2 };

const initialProfile = { major: "", year: "" };
const initialConstraints = {
  daysOff: [],
  timeBlocks: [],
  wantsLunch: false,
  lunchStart: "12:00",
  lunchEnd: "13:00",
  targetHours: "",
  maxHoursPerDay: "",
  unlimitedDailyHours: false,
};

export default function App() {
  const [stage, setStage] = useState(STAGE.PROFILE);
  const [profile, setProfile] = useState(initialProfile);
  const [constraints, setConstraints] = useState(initialConstraints);

  // Fire the moment the app mounts (start of the questionnaire) so a
  // free-tier Render backend has the whole flow to finish waking up.
  useEffect(() => {
    wakeBackend();
  }, []);

  return (
    <div className="app-shell">
      <ScheduleGridBackdrop />

      <header className="app-shell__header">
        <span className="app-shell__mark">Comet Planner</span>
        {stage < STAGE.REVIEW && <StepIndicator current={stage} />}
      </header>

      <main className="app-shell__main">
        <AnimatePresence mode="wait">
          <motion.div
            key={stage}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {stage === STAGE.PROFILE && (
              <QuestionnaireStep
                data={profile}
                onChange={setProfile}
                onNext={() => setStage(STAGE.CONSTRAINTS)}
              />
            )}

            {stage === STAGE.CONSTRAINTS && (
              <TimeConstraintsStep
                data={constraints}
                onChange={setConstraints}
                onBack={() => setStage(STAGE.PROFILE)}
                onSubmit={() => setStage(STAGE.REVIEW)}
              />
            )}

            {stage === STAGE.REVIEW && (
              <ReviewStep
                profile={profile}
                constraints={constraints}
                onEdit={() => setStage(STAGE.CONSTRAINTS)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
