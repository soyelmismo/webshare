const fs = require('fs');
const file = '/app/applet/src/components/DriveStreamDownloader.tsx';
let code = fs.readFileSync(file, 'utf8');

const target1 = `  const [auditError, setAuditError] = useState<string | null>(null);`;
const repl1 = `  const [auditError, setAuditError] = useState<string | null>(null);
  const [taskToCancel, setTaskToCancel] = useState<string | null>(null);`;

const target2 = `  const handleCancel = async (taskId: string) => {
    if (confirm("¿Seguro que deseas cancelar esta transmisión a Drive?")) {
      await cancelStreamTask(taskId);
      await refreshTasks();
    }
  };`;
const repl2 = `  const handleCancel = async (taskId: string) => {
    setTaskToCancel(taskId);
  };

  const confirmCancel = async () => {
    if (!taskToCancel) return;
    await cancelStreamTask(taskToCancel);
    await refreshTasks();
    setTaskToCancel(null);
  };`;

const target3 = `                    <button
                      onClick={() => handleCancel(task.id)}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition"
                      title="Cancelar y eliminar de la lista"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>`;
const repl3 = `                    {taskToCancel === task.id ? (
                      <div className="flex items-center gap-1 bg-red-950/40 rounded-lg p-1 border border-red-500/30">
                        <span className="text-[10px] text-red-400 font-bold uppercase px-1">¿Borrar?</span>
                        <button
                          onClick={confirmCancel}
                          className="p-1 text-white bg-red-600 hover:bg-red-500 rounded transition"
                        >
                          Sí
                        </button>
                        <button
                          onClick={() => setTaskToCancel(null)}
                          className="p-1 text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleCancel(task.id)}
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition"
                        title="Cancelar y eliminar de la lista"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}`;

if (code.includes(target1) && code.includes(target2) && code.includes(target3)) {
  code = code.replace(target1, repl1);
  code = code.replace(target2, repl2);
  code = code.replace(target3, repl3);
  fs.writeFileSync(file, code);
  console.log("Patched successfully");
} else {
  console.log("Target not found");
}
