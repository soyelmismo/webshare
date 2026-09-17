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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#000000]/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl w-full max-w-md p-5 shadow-2xl space-y-4">
        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-lg bg-[#7f1d1d]/20 border border-[#991b1b]/40 text-[#f87171] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="p-1.5 rounded-lg text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#1f242c] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-bold text-[#f3f4f6]">
            ¿Eliminar archivo de Google Drive?
          </h3>
          <p className="text-xs text-[#9ca3af]">
            Estás a punto de eliminar el siguiente archivo de tu carpeta dedicada en Google Drive:
          </p>
          <div className="p-3 bg-[#0e1013] border border-[#22272e] rounded-lg font-mono text-xs text-[#f3f4f6] break-all">
            {file.name}
            {file.size && (
              <span className="block text-[11px] text-[#9ca3af] mt-1 font-sans">
                Tamaño: {(Number(file.size) / (1024 * 1024)).toFixed(2)} MB
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#f87171]">
            Esta acción es irreversible y eliminará el recurso en tu cuenta de Google Drive.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#22272e]">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="px-3.5 py-1.5 rounded-lg bg-[#1a1e24] hover:bg-[#222831] border border-[#262b32] text-[#f3f4f6] text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-3.5 py-1.5 rounded-lg bg-[#ef4444] hover:bg-[#dc2626] text-[#ffffff] text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
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
