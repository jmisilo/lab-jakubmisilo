import type { FC, PropsWithChildren } from 'react';

const ProjectsLayout: FC<PropsWithChildren> = ({ children }) => {
  return (
    <div className="relative mx-auto max-w-120 overflow-hidden px-5 sm:max-w-140 md:max-w-152">
      {children}
    </div>
  );
};

export default ProjectsLayout;
