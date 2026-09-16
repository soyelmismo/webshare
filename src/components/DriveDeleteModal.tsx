import React from "react";
import { AlertTriangle, Trash2, X, Loader2 } from "lucide-react";
import { DriveFile } from "../types";

interface DriveDeleteModalProps {
  file: DriveFile | null;
  isOpen: boolean;
  isDeleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const DriveDeleteModal: React.FC<DriveDeleteModalProps> = ({
  file,
  isOpen,
  isDeleting,
  onConfirm,
  onClose,
}) => {
  if (!isOpen || !file) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between">
          <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-bold text-white">
            ¿Eliminar archivo de Google Drive?
          </h3>
          <p className="text-xs text-slate-300">
            Estás a punto de eliminar el siguiente archivo de tu carpeta dedicada en Google Drive:
          </p>
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl font-mono text-xs text-indigo-300 break-all">
            {file.name}
            {file.size && (
              <span className="block text-[11px] text-slate-500 mt-1">
                Tamaño: {(Number(file.size) / (1024 * 1024)).toFixed(2)} MB
              </span>
            )}
          </div>
          <p className="text-[11px] text-rose-400">
            Esta acción no se puede deshacer. Se eliminará de tu cuenta de Google Drive con tu permiso.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-lg shadow-rose-600/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Eliminando...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>Confirmar Eliminación</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
