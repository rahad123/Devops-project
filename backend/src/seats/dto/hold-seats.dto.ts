import { IsArray, IsString, ArrayMinSize, ArrayMaxSize, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class HoldSeatsDto {
  @ApiProperty({ example: ['1A', '1B'], description: 'Seat numbers to hold' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  seatNumbers: string[];

  @ApiProperty({ description: 'User ID holding the seats' })
  @IsString()
  userId: string;
}
