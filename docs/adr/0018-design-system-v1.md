# ADR 0018: Design system v1 (Figma and CSS tokens)

Status: Draft v1 for owner review. Supports #103 (Figma foundations, tokens and reusable components). The owner chose on 22 October 2026 to create the system in Figma, with a calm and professional look built on the existing deep green.

## Decision

1. **Figma is the source of the design.** The file "Real Estate Ops — Design System" is in the Ashbi Design team: https://www.figma.com/design/SRzSBB0ITIrLghr5HJaRJS. It has four pages:
   - **Cover**
   - **Foundations:** colour, type, spacing and radius specimens
   - **Components:**
     - Button: Primary, Secondary or Link, each with Default, Hover, Focus, Disabled and Loading states
     - Text field: Default, Filled, Focus, Error and Disabled
     - Select: Default, Focus and Disabled
     - Status badge: one per task status
     - Notice: Error, Warning, Info and Success
     - Task card: Open and Done
   - **Screens:** Sign in at 1440 px, and My tasks at 1440 px and 390 px
2. **Tokens are Figma variables with CSS names.** There are three collections:
   - Primitives: 19 raw colours, hidden from the Figma pickers.
   - Color: 23 semantic roles, aliased to the primitives, in a Light mode only for now.
   - Spacing: 10 spacing steps and 4 radius steps.

   Every variable has a narrow scope and a WEB code syntax `var(--reo-…)`. `apps/web/app/globals.css` defines the same names, so a value is changed in both places together.
3. **Type.** Inter, with nine text styles: Heading XL/L/M, Body L/M/S, Body M Strong, Label M and Eyebrow.
   - The site asks for `Inter, system-ui, sans-serif`. No web font is loaded, so it falls back to the system font where Inter is not installed.
   - Self-hosting Inter is a follow-up, because a font download changes the CSP and privacy review.
4. **Accessibility rules are part of the components.**
   - Text and background pairs meet WCAG AA.
   - Status is shown as text plus colour, never by colour alone.
   - Labels are always visible.
   - Errors use a 2 px red border, a message, `aria-invalid` and `aria-describedby`.
   - Focus is a 3 px green outline outside the control.
   - Touch targets are at least 44–48 px.
5. **Restyle only.** The app keeps its markup, copy and behaviour; only the stylesheet changes. Every existing screen test still passes at 390, 768 and 1440 px.

## Not done

- A dark mode.
- A self-hosted Inter font.
- Code Connect mappings between the Figma components and code.
- The Secondary button style and the Status badge are not used in the app yet: the done list still shows its status as text.
- Components for screens that do not exist yet.
- A full accessibility audit.

## Rollback

Revert `apps/web/app/globals.css`. The Figma file stays in place as a reference.
