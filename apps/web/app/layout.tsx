import type { ReactNode } from "react";
import "./globals.css";
export const metadata = {
	title: "Real Estate Ops",
	robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en-CA">
			<body>
				<a className="skip" href="#main">
					Skip to content
				</a>
				{children}
			</body>
		</html>
	);
}
