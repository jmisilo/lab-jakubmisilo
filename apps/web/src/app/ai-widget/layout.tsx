import type { FC, PropsWithChildren } from "react";

const ProjectsLayout: FC<PropsWithChildren> = ({ children }) => {
  return (
    <div className="relative overflow-hidden px-5 max-w-120 sm:max-w-140 md:max-w-152 mx-auto">
      {children}
    </div>
  );
};

export default ProjectsLayout;
