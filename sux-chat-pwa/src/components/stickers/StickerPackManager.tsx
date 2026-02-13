import { useState, useEffect } from "react";
import { api } from "@/api/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Upload, Trash2, X, Check, Share2, Download } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Sticker {
  id: string;
  pack: string;
  pack_name: string;
  file_url: string;
  file_name: string;
  emoji?: string;
  order: number;
  created_at: string;
}

interface StickerPack {
  id: string;
  name: string;
  description?: string;
  author: {
    id: string;
    username: string;
  };
  is_public: boolean;
  stickers_count: number;
  is_saved: boolean;
  created_at: string;
  updated_at: string;
}

interface UserStickerPack {
  id: string;
  pack: StickerPack;
  added_at: string;
}

interface StickerPackManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPacksUpdated?: () => void;
}

const StickerPackManager = ({ open, onOpenChange, onPacksUpdated }: StickerPackManagerProps) => {
  const [activeTab, setActiveTab] = useState<"my" | "public" | "import">("my");
  const [myPacks, setMyPacks] = useState<UserStickerPack[]>([]);
  const [publicPacks, setPublicPacks] = useState<StickerPack[]>([]);
  const [selectedPack, setSelectedPack] = useState<StickerPack | null>(null);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  
  // Создание нового пака
  const [showCreatePack, setShowCreatePack] = useState(false);
  const [newPackName, setNewPackName] = useState("");
  const [newPackDescription, setNewPackDescription] = useState("");
  const [newPackPublic, setNewPackPublic] = useState(true);
  
  // Импорт стикерпака
  const [importCode, setImportCode] = useState("");
  const [importing, setImporting] = useState(false);
  
  // Загрузка стикера
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open, activeTab]);

  useEffect(() => {
    if (selectedPack) {
      loadStickers(selectedPack.id);
    }
  }, [selectedPack]);

  const loadData = async () => {
    if (activeTab === "my") {
      await loadMyPacks();
    } else {
      await loadPublicPacks();
    }
  };

  const loadMyPacks = async () => {
    try {
      const packs = await api.getMyStickerPacks();
      setMyPacks(packs);
    } catch (error) {
      console.error("Failed to load my packs:", error);
      toast.error("Не удалось загрузить ваши стикерпаки");
    }
  };

  const loadPublicPacks = async () => {
    try {
      const packs = await api.getStickerPacks();
      setPublicPacks(packs);
    } catch (error) {
      console.error("Failed to load public packs:", error);
      toast.error("Не удалось загрузить публичные стикерпаки");
    }
  };

  const loadStickers = async (packId: string) => {
    try {
      const loadedStickers = await api.getStickers(packId);
      setStickers(loadedStickers);
    } catch (error) {
      console.error("Failed to load stickers:", error);
      toast.error("Не удалось загрузить стикеры");
    }
  };

  const handleCreatePack = async () => {
    if (!newPackName.trim()) {
      toast.error("Введите название стикерпака");
      return;
    }

    try {
      const newPack = await api.createStickerPack(
        newPackName,
        newPackDescription || undefined,
        newPackPublic
      );
      
      toast.success("Стикерпак создан");
      setShowCreatePack(false);
      setNewPackName("");
      setNewPackDescription("");
      setNewPackPublic(true);
      
      await loadMyPacks();
      onPacksUpdated?.();
      setSelectedPack(newPack);
    } catch (error) {
      console.error("Failed to create pack:", error);
      toast.error("Не удалось создать стикерпак");
    }
  };

  const handleUploadSticker = async (file: File) => {
    if (!selectedPack) {
      toast.error("Выберите стикерпак");
      return;
    }

    try {
      setUploading(true);
      
      // Загружаем файл
      const uploadResult = await api.uploadSticker(file);
      
      // Создаем стикер в паке
      await api.createSticker(
        selectedPack.id,
        uploadResult.file_url,
        uploadResult.file_name
      );
      
      toast.success("Стикер добавлен");
      await loadStickers(selectedPack.id);
      onPacksUpdated?.();
    } catch (error) {
      console.error("Failed to upload sticker:", error);
      toast.error("Не удалось загрузить стикер");
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Проверяем размер (макс. 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Файл слишком большой (макс. 5MB)");
        return;
      }

      // Проверяем формат
      const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];
      if (!allowedTypes.includes(file.type)) {
        toast.error("Разрешены только изображения (PNG, JPG, GIF, WebP)");
        return;
      }

      handleUploadSticker(file);
    }
  };

  const handleSavePack = async (pack: StickerPack) => {
    try {
      if (pack.is_saved) {
        await api.unsaveStickerPack(pack.id);
        toast.success("Стикерпак удален из сохраненных");
      } else {
        await api.saveStickerPack(pack.id);
        toast.success("Стикерпак сохранен");
      }
      
      await loadData();
      onPacksUpdated?.();
    } catch (error) {
      console.error("Failed to save/unsave pack:", error);
      toast.error("Не удалось выполнить действие");
    }
  };

  const handleDeletePack = async (packId: string) => {
    if (!confirm("Вы уверены, что хотите удалить этот стикерпак?")) {
      return;
    }

    try {
      await api.deleteStickerPack(packId);
      toast.success("Стикерпак удален");
      
      if (selectedPack?.id === packId) {
        setSelectedPack(null);
        setStickers([]);
      }
      
      await loadData();
      onPacksUpdated?.();
    } catch (error) {
      console.error("Failed to delete pack:", error);
      toast.error("Не удалось удалить стикерпак");
    }
  };

  const handleDeleteSticker = async (stickerId: string) => {
    if (!confirm("Вы уверены, что хотите удалить этот стикер?")) {
      return;
    }

    try {
      await api.deleteSticker(stickerId);
      toast.success("Стикер удален");
      
      if (selectedPack) {
        await loadStickers(selectedPack.id);
      }
      
      onPacksUpdated?.();
    } catch (error) {
      console.error("Failed to delete sticker:", error);
      toast.error("Не удалось удалить стикер");
    }
  };

  const handleSharePack = async (packId: string, packName: string) => {
    try {
      const result = await api.shareStickerPack(packId);
      
      // Копируем код в буфер обмена
      await navigator.clipboard.writeText(result.share_code);
      
      toast.success(`Код стикерпака "${packName}" скопирован в буфер обмена!`);
    } catch (error) {
      console.error("Failed to share pack:", error);
      toast.error("Не удалось создать код для обмена");
    }
  };

  const handleImportPack = async () => {
    if (!importCode.trim()) {
      toast.error("Введите код стикерпака");
      return;
    }

    try {
      setImporting(true);
      const result = await api.importStickerPackByCode(importCode.trim());
      
      if (result.status === "success") {
        toast.success(result.message);
        setImportCode("");
        await loadMyPacks();
        onPacksUpdated?.();
        setActiveTab("my");
      } else if (result.status === "already_saved") {
        toast.info(result.message);
        setImportCode("");
      }
    } catch (error: any) {
      console.error("Failed to import pack:", error);
      if (error.message.includes("not found")) {
        toast.error("Стикерпак не найден. Проверьте код.");
      } else if (error.message.includes("private")) {
        toast.error("Этот стикерпак приватный");
      } else {
        toast.error("Не удалось импортировать стикерпак");
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Управление стикерами</DialogTitle>
          <DialogDescription>
            Создавайте свои стикерпаки и добавляйте публичные
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col md:flex-row gap-4 px-6 pb-6 overflow-hidden">
          {/* Левая панель - список паков */}
          <div className="w-full md:w-1/3 flex flex-col">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "my" | "public" | "import")} className="w-full">
              <TabsList className="w-full grid grid-cols-3">
                <TabsTrigger value="my">Мои</TabsTrigger>
                <TabsTrigger value="public">Публичные</TabsTrigger>
                <TabsTrigger value="import">Импорт</TabsTrigger>
              </TabsList>

              <TabsContent value="my" className="mt-2">
                <Button
                  onClick={() => setShowCreatePack(true)}
                  className="w-full mb-2"
                  size="sm"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Создать стикерпак
                </Button>

                <ScrollArea className="h-64 md:h-96">
                  <div className="space-y-2">
                    {myPacks.map((userPack) => (
                      <div
                        key={userPack.pack.id}
                        className={cn(
                          "p-3 rounded-lg border-2 cursor-pointer transition-all",
                          selectedPack?.id === userPack.pack.id
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50"
                        )}
                        onClick={() => setSelectedPack(userPack.pack)}
                      >
                        <div className="flex-1 min-w-0 mb-2">
                          <h4 className="font-medium truncate">{userPack.pack.name}</h4>
                          <p className="text-xs text-muted-foreground">
                            {userPack.pack.stickers_count} стикеров
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 flex-1 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSharePack(userPack.pack.id, userPack.pack.name);
                            }}
                          >
                            <Share2 className="w-3 h-3 mr-1" />
                            Поделиться
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeletePack(userPack.pack.id);
                            }}
                          >
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="public" className="mt-2">
                <ScrollArea className="h-72 md:h-[26rem]">
                  <div className="space-y-2">
                    {publicPacks.map((pack) => (
                      <div
                        key={pack.id}
                        className={cn(
                          "p-3 rounded-lg border-2 cursor-pointer transition-all",
                          selectedPack?.id === pack.id
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50"
                        )}
                        onClick={() => setSelectedPack(pack)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium">{pack.name}</h4>
                          <Button
                            variant={pack.is_saved ? "default" : "outline"}
                            size="sm"
                            className="h-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSavePack(pack);
                            }}
                          >
                            {pack.is_saved ? (
                              <>
                                <Check className="w-3 h-3 mr-1" />
                                Сохранен
                              </>
                            ) : (
                              <>
                                <Plus className="w-3 h-3 mr-1" />
                                Добавить
                              </>
                            )}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Автор: {pack.author.username}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {pack.stickers_count} стикеров
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="import" className="mt-2">
                <div className="space-y-4 p-4">
                  <div>
                    <h4 className="font-medium mb-2">Импорт стикерпака</h4>
                    <p className="text-sm text-muted-foreground mb-4">
                      Введите код стикерпака, которым с вами поделились
                    </p>
                  </div>
                  
                  <div className="space-y-3">
                    <Input
                      placeholder="Вставьте код стикерпака"
                      value={importCode}
                      onChange={(e) => setImportCode(e.target.value)}
                      className="font-mono text-sm"
                    />
                    
                    <Button
                      onClick={handleImportPack}
                      disabled={importing || !importCode.trim()}
                      className="w-full"
                    >
                      {importing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                          Импорт...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4 mr-2" />
                          Импортировать
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="pt-4 border-t space-y-2">
                    <h5 className="text-sm font-medium">Как это работает?</h5>
                    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                      <li>Попросите друга поделиться своим стикерпаком</li>
                      <li>Скопируйте код, который он отправит</li>
                      <li>Вставьте код в поле выше</li>
                      <li>Нажмите "Импортировать"</li>
                    </ol>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Правая панель - стикеры выбранного пака */}
          <div className="flex-1 border-l pl-4 flex flex-col">
            {selectedPack ? (
              <>
                <div className="mb-4">
                  <h3 className="font-semibold text-lg">{selectedPack.name}</h3>
                  {selectedPack.description && (
                    <p className="text-sm text-muted-foreground">{selectedPack.description}</p>
                  )}
                </div>

                {activeTab === "my" && (
                  <div className="mb-4">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                      onChange={handleFileSelect}
                      className="hidden"
                      id="sticker-upload"
                    />
                    <Button
                      onClick={() => document.getElementById("sticker-upload")?.click()}
                      disabled={uploading}
                      size="sm"
                      className="w-full"
                    >
                      {uploading ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      ) : (
                        <Upload className="w-4 h-4 mr-2" />
                      )}
                      Загрузить стикер
                    </Button>
                  </div>
                )}

                <ScrollArea className="flex-1">
                  {stickers.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      В этом паке пока нет стикеров
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                      {stickers.map((sticker) => (
                        <div
                          key={sticker.id}
                          className="relative aspect-square rounded-lg overflow-hidden border-2 border-border group"
                        >
                          <img
                            src={sticker.file_url}
                            alt={sticker.file_name}
                            className="w-full h-full object-contain bg-secondary/50"
                          />
                          {activeTab === "my" && (
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <Button
                                variant="destructive"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleDeleteSticker(sticker.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Выберите стикерпак
              </div>
            )}
          </div>
        </div>

        {/* Диалог создания нового пака */}
        <Dialog open={showCreatePack} onOpenChange={setShowCreatePack}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Создать стикерпак</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Название</label>
                <Input
                  value={newPackName}
                  onChange={(e) => setNewPackName(e.target.value)}
                  placeholder="Название стикерпака"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Описание (опционально)</label>
                <Textarea
                  value={newPackDescription}
                  onChange={(e) => setNewPackDescription(e.target.value)}
                  placeholder="Описание стикерпака"
                  rows={3}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="public-pack"
                  checked={newPackPublic}
                  onChange={(e) => setNewPackPublic(e.target.checked)}
                  className="w-4 h-4"
                />
                <label htmlFor="public-pack" className="text-sm">
                  Публичный стикерпак (другие пользователи смогут его сохранить)
                </label>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleCreatePack} className="flex-1">
                  Создать
                </Button>
                <Button onClick={() => setShowCreatePack(false)} variant="outline">
                  Отмена
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
};

export default StickerPackManager;
