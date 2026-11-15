import React, { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import './OracleSelect.css';

export interface OracleSelectOption<T extends string | number = string> {
  value: T;
  label: string;
  badge?: string;
  desc?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface OracleSelectProps<T extends string | number = string> {
  value: T;
  onChange: (value: T) => void;
  options: OracleSelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  'aria-label'?: string;
  className?: string;
  style?: React.CSSProperties;
  triggerStyle?: React.CSSProperties;
  width?: string | number;
}

export function OracleSelect<T extends string | number = string>({
  value,
  onChange,
  options,
  placeholder = 'Select option...',
  disabled = false,
  id,
  name: _name,
  'aria-label': ariaLabel,
  className = '',
  style = {},
  triggerStyle = {},
  width
}: OracleSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const [menuCoords, setMenuCoords] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: 'bottom' | 'top';
  }>({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 0,
    placement: 'bottom'
  });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const selectId = id || generatedId;

  const listboxId = `${selectId}-options`;
  const selectedOption = options.find((opt) => opt.value === value);

  // Position calculation
  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const placement = spaceBelow < 200 && spaceAbove > spaceBelow ? 'top' : 'bottom';
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16);

    setMenuCoords({
      top: placement === 'bottom' ? rect.bottom + 4 : rect.top - 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      width,
      maxHeight: Math.min(260, Math.max(0, placement === 'bottom' ? spaceBelow : spaceAbove)),
      placement
    });
  };

  const handleOpen = () => {
    if (disabled) return;
    updatePosition();
    setIsOpen(true);
    const currIdx = options.findIndex((opt) => opt.value === value && !opt.disabled);
    setHighlightIndex(currIdx >= 0 ? currIdx : options.findIndex(opt => !opt.disabled));
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleSelect = (option: OracleSelectOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    handleClose();
    triggerRef.current?.focus();
  };

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      handleClose();
    };

    const handleScrollOrResize = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      if (event.type === 'scroll') handleClose();
      else updatePosition();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || highlightIndex < 0) return;
    const menu = menuRef.current;
    const option = menu?.children[highlightIndex];
    if (menu && option instanceof HTMLElement) {
      if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
      const bottom = option.offsetTop + option.offsetHeight;
      if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
    }
  }, [highlightIndex, isOpen]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        handleOpen();
      }
      return;
    }

    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
      handleClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((prev) => {
        let next = prev + 1;
        while (next < options.length && options[next].disabled) next++;
        return next < options.length ? next : prev;
      });
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) => {
        let prevIdx = prev - 1;
        while (prevIdx >= 0 && options[prevIdx].disabled) prevIdx--;
        return prevIdx >= 0 ? prevIdx : prev;
      });
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < options.length) {
        handleSelect(options[highlightIndex]);
      }
    }
  };

  const portalContent = isOpen && typeof document !== 'undefined' ? (
    createPortal(
      <div
        ref={menuRef}
        className="oracle-select-menu-portal"
        style={{
          top: menuCoords.placement === 'bottom' ? menuCoords.top : undefined,
          bottom:
            menuCoords.placement === 'top'
              ? window.innerHeight - menuCoords.top
              : undefined,
          left: menuCoords.left,
          width: menuCoords.width,
          maxHeight: menuCoords.maxHeight
        }}
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
      >
        {options.map((opt, idx) => {
          const isSelected = opt.value === value;
          const isHighlighted = idx === highlightIndex;

          return (
            <div
              key={String(opt.value)}
              id={`${listboxId}-${idx}`}
              role="option"
              aria-disabled={opt.disabled || undefined}
              aria-selected={isSelected}
              className={`oracle-select-item ${isSelected ? 'is-selected' : ''} ${
                opt.disabled ? 'is-disabled' : ''
              } ${isHighlighted ? 'is-highlighted' : ''}`}
              onClick={() => handleSelect(opt)}
              onMouseEnter={() => !opt.disabled && setHighlightIndex(idx)}
            >
              <div className="oracle-select-item-left">
                <span className="oracle-select-item-check">
                  {isSelected ? <Check size={12} strokeWidth={2.5} /> : null}
                </span>
                {opt.icon && <span style={{ display: 'flex' }}>{opt.icon}</span>}
                <div className="oracle-select-item-text">
                  <span className="oracle-select-item-label">{opt.label}</span>
                  {opt.desc && (
                    <span className="oracle-select-item-desc">{opt.desc}</span>
                  )}
                </div>
              </div>
              {opt.badge && (
                <span className="oracle-select-badge">{opt.badge}</span>
              )}
            </div>
          );
        })}
      </div>,
      document.body
    )
  ) : null;

  return (
    <div
      className={`oracle-select-root ${className}`}
      style={{ width: width ?? style.width ?? '100%', ...style }}
    >
      <button
        type="button"
        ref={triggerRef}
        id={selectId}
        disabled={disabled}
        onClick={() => (isOpen ? handleClose() : handleOpen())}
        onKeyDown={handleKeyDown}
        className={`oracle-select-trigger ${isOpen ? 'is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen && highlightIndex >= 0 ? `${listboxId}-${highlightIndex}` : undefined}
        aria-label={ariaLabel}
        style={triggerStyle}
      >
        <div className="oracle-select-content">
          {selectedOption?.icon && (
            <span style={{ display: 'flex' }}>{selectedOption.icon}</span>
          )}
          <span
            className={`oracle-select-value ${
              !selectedOption ? 'oracle-select-placeholder' : ''
            }`}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.badge && (
            <span className="oracle-select-badge">{selectedOption.badge}</span>
          )}
        </div>
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={`oracle-select-chevron ${isOpen ? 'is-open' : ''}`}
        />
      </button>

      {/* Accessible native select in sync for automated tests & screen readers */}
      <select
        aria-label={ariaLabel}
        tabIndex={-1}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const val = typeof value === 'number' ? Number(e.target.value) : e.target.value;
          onChange(val as T);
        }}
        className="oracle-select-hidden-native"
      >
        {options.map((opt) => (
          <option key={String(opt.value)} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>

      {portalContent}
    </div>
  );
}
