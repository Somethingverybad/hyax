import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Тосты всплывают снизу и перекрывали поле ввода сообщений. Поднимаем
      // их над ним: высота строки ввода плюс отступ под home-индикатором.
      position="bottom-center"
      // 2с вместо стандартных 4: подтверждения читаются мгновенно, а висящий
      // тост перекрывает интерфейс.
      duration={2000}
      offset="calc(5.5rem + env(safe-area-inset-bottom, 0px))"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
