/**
 * Folder selector component for the upload workflow.
 * Dropdown menu to select a target folder for uploads.
 */

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ChevronDownIcon } from '@heroicons/react/24/outline'

import type { FolderItem } from '~/types/upload'

interface UploadFolderSelectorProps {
  selectedFolder: string
  availableFolders: FolderItem[]
  onSelect: (folder: string) => void
}

/**
 * Dropdown selector for choosing the target upload folder.
 */
export function UploadFolderSelector({
  selectedFolder,
  availableFolders,
  onSelect,
}: UploadFolderSelectorProps) {
  return (
    <div className="mb-6">
      <label
        htmlFor="folder-select"
        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
      >
        Upload to folder (optional)
      </label>
      <Menu as="div" className="relative w-full sm:w-96">
        <MenuButton className="relative w-full cursor-pointer rounded-md bg-white dark:bg-gray-800 py-2 pl-3 pr-10 text-left shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm">
          <span className="block truncate text-gray-900 dark:text-gray-200">
            {selectedFolder || 'Root (no folder)'}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
          </span>
        </MenuButton>

        <MenuItems className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white dark:bg-gray-800 py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
          <MenuItem>
            <button
              onClick={() => onSelect('')}
              className="w-full text-left px-3 py-2 text-sm text-gray-900 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:outline-none"
            >
              Root (no folder)
            </button>
          </MenuItem>
          {availableFolders.map(folder => (
            <MenuItem key={folder.path}>
              <button
                onClick={() => onSelect(folder.path)}
                className="w-full text-left px-3 py-2 text-sm text-gray-900 dark:text-gray-200 data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-700 data-[focus]:outline-none"
              >
                {folder.path}
              </button>
            </MenuItem>
          ))}
          {availableFolders.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 italic">
              No folders available
            </div>
          )}
        </MenuItems>
      </Menu>
      {selectedFolder && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
          Videos will be uploaded to: <span className="font-medium">{selectedFolder}/</span>
        </p>
      )}
    </div>
  )
}
